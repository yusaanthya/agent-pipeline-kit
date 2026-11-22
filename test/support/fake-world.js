// A fake `run` for collector tests: it records every call and answers `gh api`
// and `git` invocations from a small canned repository. A helper, not a test.

const HEAD = 'a'.repeat(40);
const BASE = 'b'.repeat(40);
const MB = 'f'.repeat(40);
const MERGE_COMMIT = 'e'.repeat(40);
const PARENT = '9'.repeat(40);
const TRUST = '8'.repeat(40);
const S_OLD = '1'.repeat(40);
const S_NEW = '2'.repeat(40);
const ZERO = '0'.repeat(40);

export const SHAS = { HEAD, BASE, MB, MERGE_COMMIT, PARENT, TRUST, S_OLD, S_NEW };

const manifest = JSON.stringify({
  schema: 1,
  kit: 'a'.repeat(40),
  checks: ['check'],
  codex_clean: 'no_blocking',
  hold_paths: [],
  lanes: {
    runner: {
      kind: 'queue', base: 'main', auto_merge: true,
      tier: { default: 'auto', strong_review: [] }, max_changed_lines: null,
      marker: 'Auto-Merged-By: test-runner',
      freeze_while_open: { head: 'preview', base: 'main' },
    },
  },
});

const rawEntry = (meta, path) => `${meta}\0${path}\0`;

export function makeWorld(over = {}) {
  const calls = [];
  const repo = 'owner/repo';
  const ns = `refs/agent-pipeline-kit/${over.pid ?? 4242}`;
  const pr = {
    number: 7, state: 'open', merged: false, draft: false, title: 'feat: add x', mergeable: true,
    head: { sha: HEAD, ref: 'claude/item-sim-1', repo: { full_name: 'owner/repo' } },
    base: { ref: 'main' },
    merge_commit_sha: null, merged_at: null,
    ...(over.pr ?? {}),
  };
  const rest = {
    [`/repos/${repo}`]: { default_branch: 'main' },
    [`/repos/${repo}/pulls/7`]: pr,
    [`/repos/${repo}/commits/${HEAD}/check-runs?filter=all`]: { check_runs: [{ id: 1, name: 'check', app: { slug: 'github-actions' }, status: 'completed', conclusion: 'success' }] },
    [`/repos/${repo}/issues/7/comments`]: [{ id: 1, user: { id: 5, login: 'x' }, body: 'hi' }],
    [`/repos/${repo}/pulls/7/comments`]: [],
    [`/repos/${repo}/pulls/7/reviews`]: [],
    [`/repos/${repo}/issues?labels=pipeline-halt&state=open`]: [],
    [`/repos/${repo}/issues?labels=pipeline-halt&state=all`]: [],
    [`/repos/${repo}/pulls?state=open`]: [{ number: 9, head: { ref: 'preview', repo: { full_name: 'owner/repo' } }, base: { ref: 'main' }, created_at: '2026-11-01T00:00:00Z', closed_at: null }],
    [`/repos/${repo}/issues/7/timeline`]: [],
    [`/repos/${repo}/pulls?state=all&head=owner:preview&base=main`]: [],
    ...(over.rest ?? {}),
  };
  const refs = {
    [`${ns}/trust`]: TRUST,
    [`${ns}/base`]: BASE,
    [`${ns}/head`]: HEAD,
    [`${MERGE_COMMIT}^1`]: PARENT,
    [MERGE_COMMIT]: MERGE_COMMIT,
    ...(over.refs ?? {}),
  };
  const blobs = {
    [`${ns}/trust:.agent-line/manifest.json`]: manifest,
    [`${TRUST}:.agent-line/manifest.json`]: manifest,
    [`${BASE}:.agent-line/queue/sim-1.md`]: '---\nmerge: runner\n---\n',
    [`${PARENT}:.agent-line/queue/sim-1.md`]: '---\nmerge: runner\n---\n',
    [S_NEW]: 'hello\n',
    [S_OLD]: 'old\n',
    ...(over.blobs ?? {}),
  };
  const diffRaw = over.diffRaw ?? [
    rawEntry(`:100644 100644 ${S_OLD} ${S_NEW} M`, 'src/x.go'),
    rawEntry(`:000000 100644 ${ZERO} ${S_NEW} A`, '.agent-line/reports/sim-1.md'),
  ].join('');
  const numstat = over.numstat ?? '3\t1\tsrc/x.go\x0010\t0\t.agent-line/reports/sim-1.md\0';
  const log = over.log ?? 'feat: add x (#7)\n\nAuto-Merged-By: test-runner\n';

  const reply = (stdout = '', code = 0, stderr = '') => ({ stdout: Buffer.from(stdout), stderr: Buffer.from(stderr), code });

  async function run(cmd, args, options) {
    calls.push({ cmd, args: [...args], options });
    if (over.runHook) {
      const hooked = await over.runHook(cmd, args);
      if (hooked) return hooked;
    }
    if (cmd === 'gh') {
      const full = args[args.length - 1];
      const [path, query] = full.split('?');
      const params = new URLSearchParams(query ?? '');
      const page = Number(params.get('page') ?? 1);
      params.delete('page');
      params.delete('per_page');
      const rest0 = params.toString();
      const key = rest0 ? `${path}?${rest0}` : path;
      // The canned keys are written with the query as the code builds it.
      const exact = Object.keys(rest).find((k) => k === key || k === decodeURIComponent(key));
      if (exact === undefined) return reply('', 1, `HTTP 404: ${full}`);
      const body = rest[exact];
      if (Array.isArray(body)) return reply(JSON.stringify(body.slice((page - 1) * 100, page * 100)));
      if (body && body.check_runs) return reply(JSON.stringify({ check_runs: body.check_runs.slice((page - 1) * 100, page * 100) }));
      return reply(JSON.stringify(body));
    }
    if (cmd !== 'git') throw new Error(`unexpected command ${cmd}`);
    const a = args.slice(2); // drop -C <dir>
    switch (a[0]) {
      case 'fetch': return reply('', over.fetchCode ?? 0);
      case 'rev-parse': {
        const ref = a[a.length - 1].replace(/\^\{commit\}$/, '');
        return refs[ref] ? reply(`${refs[ref]}\n`) : reply('', 1);
      }
      case 'merge-base':
        if (a[1] === '--is-ancestor') return reply('', over.ancestor?.[`${a[2]}`] ?? 0);
        return reply(`${MB}\n`);
      case 'diff':
        return a.includes('--raw') ? reply(diffRaw) : reply(numstat);
      case 'cat-file': {
        if (a[1] === '-e') return blobs[a[2]] !== undefined ? reply() : reply('', 128, 'fatal: path does not exist');
        return blobs[a[2]] !== undefined ? reply(blobs[a[2]]) : reply('', 128);
      }
      case 'log': return reply(log);
      case 'rev-list': return reply(over.revList ?? `${TRUST}\n`);
      case 'update-ref': return reply();
      default: throw new Error(`unexpected git command ${a.join(' ')}`);
    }
  }
  return { run, calls, ns, repo };
}
