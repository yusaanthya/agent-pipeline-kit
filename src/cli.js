#!/usr/bin/env node
// agent-pipeline-gate: evaluate | replay | backtest | check-paths | hook.
import { readFile as fsReadFile, realpath } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collect as realCollect, collectPaths } from './collect/collect.js';
import { makeGithub } from './collect/github.js';
import { isRefName } from './collect/git.js';
import { run as realRun } from './collect/proc.js';
import { evaluate, evaluatePaths } from './core/verdict.js';

const USAGE = [
  'usage: agent-pipeline-gate evaluate --repo OWNER/NAME --pr N --repo-dir DIR [--lane NAME] [--manifest FILE]',
  '       agent-pipeline-gate replay   --repo OWNER/NAME --pr N --repo-dir DIR [--manifest FILE]',
  '       agent-pipeline-gate backtest --repo OWNER/NAME --repo-dir DIR --since ISO --until ISO [--base BRANCH] [--manifest FILE]',
  '       agent-pipeline-gate check-paths --repo OWNER/NAME --repo-dir DIR --base BRANCH --head SHA [--lane NAME] [--item ID] [--manifest FILE]',
  '       agent-pipeline-gate hook --repo-dir DIR   (PreToolUse tool-call JSON on stdin)',
];

const COMMANDS = {
  evaluate: { required: ['repo', 'pr', 'repo-dir'], optional: ['lane', 'manifest'] },
  replay: { required: ['repo', 'pr', 'repo-dir'], optional: ['manifest'] },
  backtest: { required: ['repo', 'repo-dir', 'since', 'until'], optional: ['base', 'manifest'] },
  'check-paths': { required: ['repo', 'repo-dir', 'base', 'head'], optional: ['lane', 'item', 'manifest'] },
  hook: { required: ['repo-dir'], optional: [] },
};

const DATE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2}))?$/;

const isRepo = (repo) => /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(repo) && !repo.split('/').some((p) => p === '.' || p === '..');

class UsageError extends Error {}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const spec = Object.hasOwn(COMMANDS, command ?? '') ? COMMANDS[command] : null;
  if (spec === null) throw new UsageError(`unknown command: ${command ?? '(none)'}`);
  const allowed = [...spec.required, ...spec.optional];
  const opts = {};
  for (let i = 0; i < rest.length; i += 2) {
    const flag = rest[i];
    if (!flag.startsWith('--') || !allowed.includes(flag.slice(2))) throw new UsageError(`unknown option: ${flag}`);
    const name = flag.slice(2);
    const value = rest[i + 1];
    if (value === undefined || value.startsWith('--')) throw new UsageError(`missing value for ${flag}`);
    if (Object.hasOwn(opts, name)) throw new UsageError(`duplicate option: ${flag}`);
    opts[name] = value;
  }
  for (const name of spec.required) {
    if (!Object.hasOwn(opts, name)) throw new UsageError(`missing option: --${name}`);
  }
  if (Object.hasOwn(opts, 'repo') && !isRepo(opts.repo)) throw new UsageError('--repo must be OWNER/NAME');
  if (Object.hasOwn(opts, 'pr') && !(/^[1-9]\d*$/.test(opts.pr) && Number.isSafeInteger(Number(opts.pr)))) {
    throw new UsageError('--pr must be a positive integer');
  }
  if (Object.hasOwn(opts, 'lane') && !/^[a-z][a-z0-9-]*$/.test(opts.lane)) throw new UsageError('--lane is not a valid lane name');
  if (Object.hasOwn(opts, 'base') && !isRefName(opts.base)) throw new UsageError('--base is not a valid branch name');
  if (Object.hasOwn(opts, 'head') && !/^[0-9a-f]{40}$/.test(opts.head)) throw new UsageError('--head must be a full 40-character commit SHA');
  if (Object.hasOwn(opts, 'item')) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(opts.item)) throw new UsageError('--item is not a valid queue item id');
    if (!Object.hasOwn(opts, 'lane')) throw new UsageError('--item requires --lane');
  }
  for (const name of ['since', 'until']) {
    if (Object.hasOwn(opts, name) && !(DATE.test(opts[name]) && !Number.isNaN(Date.parse(opts[name])))) {
      throw new UsageError(`--${name} must be an ISO 8601 date or timestamp`);
    }
  }
  if (command === 'backtest' && !(Date.parse(opts.since) < Date.parse(opts.until))) {
    throw new UsageError('--since must be before --until');
  }
  return { command, opts };
}

const markerOf = (message) => {
  if (typeof message !== 'string') return null;
  const line = message.split('\n').find((l) => l.startsWith('Auto-Merged-By:'));
  return line === undefined ? null : line.replace(/\r$/, '');
};

async function kitCommit(run, cliDir) {
  try {
    const result = await run('git', ['-C', cliDir, 'rev-parse', 'HEAD']);
    const sha = result.stdout.toString('utf8').trim();
    return result.code === 0 && /^[0-9a-f]{40}$/.test(sha) ? sha : 'unknown';
  } catch {
    return 'unknown';
  }
}

const failure = (detail) => ({
  verdict: 'blocked:input',
  lane: null,
  headSha: null,
  reasons: [{ verdict: 'blocked:input', code: 'collect-failed', detail }],
  merge: null,
  codex: { state: 'not-evaluated', code: null },
  limits: [],
});

// Collects and evaluates one pull request. Any throw is a blocked:input result.
async function gate(options, io) {
  try {
    const input = await io.collect(options, { run: io.run, readFile: io.readFile });
    return { result: evaluate(input), input };
  } catch (error) {
    return { result: failure(String(error?.message ?? error)), input: null };
  }
}

async function runOne(command, opts, io, kit) {
  const { result, input } = await gate({
    repo: opts.repo,
    prNumber: Number(opts.pr),
    repoDir: opts['repo-dir'],
    callerLane: opts.lane ?? null,
    replay: command === 'replay',
    manifestFile: opts.manifest ?? null,
  }, io);
  const out = { ...result, kit };
  if (command === 'replay') {
    out.mergeCommit = input?.mergeCommit ?? null;
    out.mergedAt = input?.asOf ?? null;
    out.marker = markerOf(input?.mergeMessage);
  }
  io.out(JSON.stringify(out));
  return result.verdict === 'merge' ? 0 : 1;
}

// The change-set conditions for a base branch and a head commit, with no pull request.
async function runCheckPaths(opts, io, kit) {
  const head = opts.head;
  let result;
  let input;
  try {
    input = await collectPaths({
      repo: opts.repo,
      repoDir: opts['repo-dir'],
      base: opts.base,
      head,
      lane: opts.lane ?? null,
      item: opts.item ?? null,
      manifestFile: opts.manifest ?? null,
    }, { run: io.run, readFile: io.readFile });
    result = evaluatePaths(input);
  } catch (error) {
    input = null;
    result = {
      result: 'blocked:input',
      lane: null,
      reasons: [{ verdict: 'blocked:input', code: 'collect-failed', detail: String(error?.message ?? error) }],
    };
  }
  if (result.usage !== undefined) {
    io.err(result.usage);
    for (const line of USAGE) io.err(line);
    return 2;
  }
  io.out(JSON.stringify({
    repo: opts.repo,
    kit,
    base: input?.base ?? null,
    mergeBase: input?.mergeBase ?? null,
    head,
    lane: result.lane,
    result: result.result,
    reasons: result.reasons,
  }));
  return result.result === 'clear' ? 0 : 1;
}

async function runBacktest(opts, io, kit) {
  const since = Date.parse(opts.since);
  const until = Date.parse(opts.until);
  let merged;
  try {
    const gh = makeGithub(io.run);
    const base = Object.hasOwn(opts, 'base') ? `&base=${encodeURIComponent(opts.base)}` : '';
    const closed = await gh.paginate(`/repos/${opts.repo}/pulls?state=closed&sort=updated&direction=desc${base}`);
    merged = closed
      .filter((p) => typeof p.merged_at === 'string' && Date.parse(p.merged_at) >= since && Date.parse(p.merged_at) < until)
      .sort((a, b) => Date.parse(a.merged_at) - Date.parse(b.merged_at) || a.number - b.number);
  } catch (error) {
    io.out(JSON.stringify({ error: 'collect-failed', detail: String(error?.message ?? error) }));
    return 1;
  }
  const byVerdict = {};
  const anomalies = [];
  const unmarkedNotMerge = [];
  for (const pull of merged) {
    const { result, input } = await gate({
      repo: opts.repo, prNumber: pull.number, repoDir: opts['repo-dir'], callerLane: null, replay: true, manifestFile: opts.manifest ?? null,
    }, io);
    const marker = input === null ? null : markerOf(input.mergeMessage);
    io.out(JSON.stringify({
      repo: opts.repo,
      pr: pull.number,
      mergedAt: pull.merged_at,
      mergeCommit: input?.mergeCommit ?? pull.merge_commit_sha ?? null,
      marker,
      verdict: result.verdict,
      reasons: result.reasons,
      limits: result.limits,
    }));
    byVerdict[result.verdict] = (byVerdict[result.verdict] ?? 0) + 1;
    if (result.verdict !== 'merge') {
      // A pull request whose replay failed has an unknown marker: it is listed
      // in both lists so that nothing is hidden.
      if (input === null || marker !== null) anomalies.push(pull.number);
      if (input === null || marker === null) unmarkedNotMerge.push(pull.number);
    }
  }
  io.out(JSON.stringify({ summary: { total: merged.length, byVerdict, anomalies, unmarkedNotMerge, kit } }));
  return 0;
}

const blockMerge = (io, message) => {
  io.err(`merge blocked: ${message}`);
  return 2;
};

// PreToolUse hook: allows the merge tool only when the gate says `merge` and the
// call matches the verdict's merge object. Exit 2 blocks, so every failure blocks.
async function runHook(opts, io) {
  try {
    const call = JSON.parse(await io.stdin());
    if (typeof call?.tool_name !== 'string') return blockMerge(io, 'malformed tool call');
    if (!call.tool_name.endsWith('__merge_pull_request')) return 0;
    const t = call.tool_input;
    const repo = typeof t?.owner === 'string' && typeof t?.repo === 'string' ? `${t.owner}/${t.repo}` : '';
    if (!isRepo(repo)) return blockMerge(io, 'malformed tool input');
    const { result } = await gate({ repo, prNumber: t.pullNumber, repoDir: opts['repo-dir'], callerLane: null, replay: false, manifestFile: null }, io);
    if (result.verdict !== 'merge') {
      const first = result.reasons[0];
      return blockMerge(io, `verdict ${result.verdict}${first ? ` (${first.code}${first.detail === undefined ? '' : `: ${first.detail}`})` : ''}`);
    }
    const { method, expectedHeadSha, commitMessage } = result.merge;
    if (t.expectedHeadSha !== expectedHeadSha) return blockMerge(io, `expectedHeadSha must be ${expectedHeadSha}`);
    if (t.merge_method !== method) return blockMerge(io, `merge_method must be ${method}`);
    if (typeof t.commit_message !== 'string' || !t.commit_message.split('\n').map((l) => l.replace(/\r$/, '')).includes(commitMessage)) {
      return blockMerge(io, `commit_message must contain the line: ${commitMessage}`);
    }
    return 0;
  } catch (error) {
    return blockMerge(io, String(error?.message ?? error));
  }
}

/**
 * @param {string[]} argv
 * @param {object} [overrides] test seams: collect, run, readFile, stdin, out, err, cliDir
 * @returns {Promise<number>} the exit code
 */
export async function main(argv, overrides = {}) {
  const io = {
    collect: realCollect,
    run: realRun,
    readFile: (path) => fsReadFile(path, 'utf8'),
    stdin: async () => {
      const chunks = [];
      for await (const chunk of process.stdin) chunks.push(chunk);
      return Buffer.concat(chunks).toString('utf8');
    },
    out: (line) => process.stdout.write(`${line}\n`),
    err: (line) => process.stderr.write(`${line}\n`),
    cliDir: dirname(fileURLToPath(import.meta.url)),
    ...overrides,
  };
  let parsed;
  try {
    parsed = parseArgs(argv);
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    io.err(error.message);
    for (const line of USAGE) io.err(line);
    return 2;
  }
  if (parsed.command === 'hook') return runHook(parsed.opts, io);
  const kit = await kitCommit(io.run, io.cliDir);
  if (parsed.command === 'check-paths') return runCheckPaths(parsed.opts, io, kit);
  if (parsed.command === 'backtest') return runBacktest(parsed.opts, io, kit);
  return runOne(parsed.command, parsed.opts, io, kit);
}

// Run as a program, also through the `bin` symlink.
const entry = process.argv[1] ? await realpath(process.argv[1]).catch(() => null) : null;
if (entry !== null && entry === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (error) => {
    process.stderr.write(`${error?.stack ?? error}\n`);
    process.exitCode = 1;
  });
}
