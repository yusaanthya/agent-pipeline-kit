// The input collector (implementation plan section 4): reads GitHub REST and
// git objects and builds a GateInput. It holds no decisions, never checks out
// and never executes pull request code.
import { HALT_LABEL, QUEUE_BRANCH, QUEUE_DIR } from '../core/constants.js';
import { parseManifest } from '../core/manifest.js';
import { isRefName, makeGit } from './git.js';
import { makeGithub } from './github.js';

const REPO = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;
const LANE_NAME = /^[a-z][a-z0-9-]*$/;
const SHA = /^[0-9a-f]{40}$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const MANIFEST_PATH = '.agent-line/manifest.json';

function need(condition, message) {
  if (!condition) throw new Error(message);
}

/**
 * @param {{repo: string, prNumber: number, repoDir: string, callerLane?: string|null, replay?: boolean, manifestFile?: string|null}} options
 * @param {{run: Function, readFile: (path: string) => Promise<string>, pid?: number}} deps
 * @returns {Promise<import('../core/verdict.js').GateInput>} throws on any failed or unexpected API or git result
 */
export async function collect(options, deps) {
  const { repo, prNumber, repoDir, callerLane = null, replay = false, manifestFile = null } = options;
  need(typeof repo === 'string' && REPO.test(repo) && !repo.split('/').some((part) => part === '.' || part === '..'), 'invalid repository name');
  need(Number.isSafeInteger(prNumber) && prNumber > 0, 'invalid pull request number');
  need(typeof repoDir === 'string' && repoDir !== '' && !repoDir.includes('\0'), 'invalid repository directory');
  need(callerLane === null || (typeof callerLane === 'string' && LANE_NAME.test(callerLane)), 'invalid lane name');

  const gh = makeGithub(deps.run);
  const git = makeGit(deps.run, repoDir);
  const ns = `refs/agent-pipeline-kit/${deps.pid ?? process.pid}`;
  const refs = { trust: `${ns}/trust`, base: `${ns}/base`, head: `${ns}/head` };
  const state = { fetching: false };
  try {
    return await gather({ repo, prNumber, callerLane, replay, manifestFile }, { gh, git, readFile: deps.readFile, refs, state });
  } finally {
    if (state.fetching) for (const ref of Object.values(refs)) await git.deleteRef(ref);
  }
}

const mapItems = (items, fn) => items.map(fn);
const haltOf = (issue) => ({ number: issue.number, createdAt: issue.created_at, closedAt: issue.closed_at ?? null });
const pullOf = (pull, closedAt) => ({
  number: pull.number,
  headRef: pull.head.ref,
  headRepo: pull.head.repo?.full_name ?? '',
  baseRef: pull.base.ref,
  createdAt: pull.created_at,
  closedAt,
});

async function gather({ repo, prNumber, callerLane, replay, manifestFile }, { gh, git, readFile, refs, state }) {
  const limits = [];

  // 1. Repository and pull request.
  const repoInfo = await gh.get(`/repos/${repo}`);
  const data = await gh.get(`/repos/${repo}/pulls/${prNumber}`);
  const defaultBranch = repoInfo?.default_branch;
  const headSha = data?.head?.sha;
  const headRef = data?.head?.ref;
  const baseRef = data?.base?.ref;

  // 2. Validate every value that reaches a git argument.
  need(isRefName(defaultBranch), `invalid ref name for the default branch: ${JSON.stringify(defaultBranch)}`);
  need(isRefName(baseRef), `invalid ref name for the base branch: ${JSON.stringify(baseRef)}`);
  need(typeof headSha === 'string' && SHA.test(headSha), 'the API returned an invalid head SHA');
  need(data.number === prNumber, 'the API returned another pull request');
  need(typeof headRef === 'string', 'the API returned no head branch');
  if (replay) {
    need(data.merged === true, 'the pull request is not merged');
    need(typeof data.merged_at === 'string' && ISO_UTC.test(data.merged_at), 'the API returned an invalid merge time');
    need(typeof data.merge_commit_sha === 'string' && SHA.test(data.merge_commit_sha), 'the API returned an invalid merge commit SHA');
  }
  const asOf = replay ? data.merged_at : null;
  const mergeCommit = replay ? data.merge_commit_sha : null;

  // 3. Fetch into a private namespace; the fetched head must be the API's head.
  state.fetching = true;
  await git.fetch([
    `+refs/heads/${defaultBranch}:${refs.trust}`,
    `+refs/heads/${baseRef}:${refs.base}`,
    `+refs/pull/${prNumber}/head:${refs.head}`,
  ]);
  const fetchedHead = await git.resolve(refs.head);
  need(fetchedHead === headSha, 'the fetched head differs from the API head (the head moved)');
  let baseSha = await git.resolve(refs.base);
  let mergeMessage = null;
  if (replay) {
    need(await git.isAncestor(mergeCommit, refs.base), 'the merge commit is not reachable from the base branch');
    baseSha = await git.resolve(`${mergeCommit}^1`);
    mergeMessage = await git.message(mergeCommit);
  }

  // 4. Manifest: the fetched default branch, never the working tree or the pull request.
  let manifestText;
  if (manifestFile !== null) {
    manifestText = await readFile(manifestFile);
  } else if (replay) {
    const at = await git.lastBefore(refs.trust, asOf);
    manifestText = at === null ? null : await git.textAt(at, MANIFEST_PATH);
    limits.push('manifest-by-commit-date');
  } else {
    manifestText = await git.textAt(refs.trust, MANIFEST_PATH);
  }

  // 5. Ancestry.
  const mergeBase = await git.mergeBase(baseSha, headSha);
  const baseIsAncestor = await git.isAncestor(baseSha, headSha);

  // 6. Changed files.
  const raw = await git.diffRaw(mergeBase, headSha);
  const numstat = new Map((await git.diffNumstat(mergeBase, headSha)).map((entry) => [entry.key, entry]));
  const files = [];
  for (const entry of raw) {
    const counts = numstat.get(entry.key);
    need(counts !== undefined, `numstat has no entry for ${entry.path}`);
    let headHasNul = null;
    if (entry.headMode === '100644') {
      need(SHA.test(entry.dstSha), 'git returned an invalid blob SHA');
      headHasNul = (await git.blob(entry.dstSha)).includes(0);
    }
    files.push({
      path: entry.path,
      pathBytesOk: entry.pathBytesOk,
      status: entry.status,
      baseMode: entry.baseMode,
      headMode: entry.headMode,
      headHasNul,
      added: counts.added,
      deleted: counts.deleted,
    });
  }

  // 7. Queue item at the base tip.
  const input = {};
  const queue = QUEUE_BRANCH.exec(headRef);
  if (queue) input.queueItemText = await git.textAt(baseSha, `${QUEUE_DIR}/${queue[1]}.md`);

  // 8. REST lists, every page.
  const checkRuns = await gh.paginate(`/repos/${repo}/commits/${headSha}/check-runs?filter=all`, 'check_runs');
  const comments = await gh.paginate(`/repos/${repo}/issues/${prNumber}/comments`);
  const reviewComments = await gh.paginate(`/repos/${repo}/pulls/${prNumber}/comments`);
  const reviews = await gh.paginate(`/repos/${repo}/pulls/${prNumber}/reviews`);
  const halt = await gh.paginate(`/repos/${repo}/issues?labels=${HALT_LABEL}&state=${replay ? 'all' : 'open'}`);
  const haltIssues = mapItems(halt, haltOf);

  let title = data.title;
  let pulls;
  if (!replay) {
    pulls = mapItems(await gh.paginate(`/repos/${repo}/pulls?state=open`), (p) => pullOf(p, null));
  } else {
    limits.push('halt-label-timing');
    // Title: the `from` of the earliest rename after asOf.
    const timeline = await gh.paginate(`/repos/${repo}/issues/${prNumber}/timeline`);
    const renames = timeline
      .filter((e) => e.event === 'renamed' && Date.parse(e.created_at) > Date.parse(asOf))
      .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
    if (renames.length > 0) {
      need(typeof renames[0].rename?.from === 'string', 'a rename event has no previous title');
      title = renames[0].rename.from;
    }
    // Freeze candidates, any state, for each lane that declares a freeze.
    pulls = [];
    const manifest = parseManifest(manifestText);
    const freezes = manifest.ok
      ? Object.values(manifest.manifest.lanes).map((lane) => lane.freeze_while_open).filter(Boolean)
      : [];
    if (freezes.length > 0) limits.push('freeze-retarget-unknown');
    const owner = repo.split('/')[0];
    const seen = new Set();
    for (const { head, base } of freezes) {
      const query = `head=${encodeURIComponent(`${owner}:${head}`)}&base=${encodeURIComponent(base)}`;
      for (const p of await gh.paginate(`/repos/${repo}/pulls?state=all&${query}`)) {
        if (seen.has(p.number)) continue;
        seen.add(p.number);
        pulls.push(pullOf(p, p.closed_at ?? null));
      }
    }
  }

  return {
    schema: 1,
    repo,
    manifestText,
    callerLane,
    asOf,
    pr: {
      number: prNumber,
      state: data.state,
      merged: data.merged === true,
      draft: replay ? false : data.draft === true,
      title,
      headRepo: data.head.repo?.full_name ?? '',
      headRef,
      headSha,
      baseRef,
      mergeable: replay ? null : (typeof data.mergeable === 'boolean' ? data.mergeable : null),
    },
    files,
    baseSha,
    baseIsAncestor,
    ...input,
    checkRuns,
    codex: { comments, reviewComments, reviews },
    haltIssues,
    pulls,
    mergeMessage,
    mergeCommit,
    limits,
  };
}
