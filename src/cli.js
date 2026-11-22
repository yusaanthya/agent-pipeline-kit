#!/usr/bin/env node
// agent-pipeline-gate: evaluate | replay | backtest (implementation plan 5).
import { readFile as fsReadFile, realpath } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collect as realCollect } from './collect/collect.js';
import { makeGithub } from './collect/github.js';
import { isRefName } from './collect/git.js';
import { run as realRun } from './collect/proc.js';
import { evaluate } from './core/verdict.js';

const USAGE = [
  'usage: agent-pipeline-gate evaluate --repo OWNER/NAME --pr N --repo-dir DIR [--lane NAME] [--manifest FILE]',
  '       agent-pipeline-gate replay   --repo OWNER/NAME --pr N --repo-dir DIR [--manifest FILE]',
  '       agent-pipeline-gate backtest --repo OWNER/NAME --repo-dir DIR --since ISO --until ISO [--base BRANCH] [--manifest FILE]',
];

const COMMANDS = {
  evaluate: { required: ['repo', 'pr', 'repo-dir'], optional: ['lane', 'manifest'] },
  replay: { required: ['repo', 'pr', 'repo-dir'], optional: ['manifest'] },
  backtest: { required: ['repo', 'repo-dir', 'since', 'until'], optional: ['base', 'manifest'] },
};

const DATE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2}))?$/;

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
  if (!/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(opts.repo) || opts.repo.split('/').some((p) => p === '.' || p === '..')) {
    throw new UsageError('--repo must be OWNER/NAME');
  }
  if (Object.hasOwn(opts, 'pr') && !(/^[1-9]\d*$/.test(opts.pr) && Number.isSafeInteger(Number(opts.pr)))) {
    throw new UsageError('--pr must be a positive integer');
  }
  if (Object.hasOwn(opts, 'lane') && !/^[a-z][a-z0-9-]*$/.test(opts.lane)) throw new UsageError('--lane is not a valid lane name');
  if (Object.hasOwn(opts, 'base') && !isRefName(opts.base)) throw new UsageError('--base is not a valid branch name');
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

/**
 * @param {string[]} argv
 * @param {object} [overrides] test seams: collect, run, readFile, out, err, cliDir
 * @returns {Promise<number>} the exit code
 */
export async function main(argv, overrides = {}) {
  const io = {
    collect: realCollect,
    run: realRun,
    readFile: (path) => fsReadFile(path, 'utf8'),
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
  const kit = await kitCommit(io.run, io.cliDir);
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
