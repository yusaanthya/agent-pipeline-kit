// The input collector reads GitHub REST and git objects to build a GateInput.
// It holds no decisions and never checks out or executes pull request code.
import { CONTENT_MAX_BYTES, HALT_LABEL, QUEUE_BRANCH, QUEUE_DIR } from '../core/constants.js';
import { contentTargets } from '../core/content.js';
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
 * @param {{repo: string, prNumber: number, repoDir: string, callerLane?: string|null, titleLane?: {commitMessage: string|null}|null, replay?: boolean, manifestFile?: string|null}} options
 * @param {{run: Function, readFile: (path: string) => Promise<string>, pid?: number}} deps
 * @returns {Promise<import('../core/verdict.js').GateInput>} throws on any failed or unexpected API or git result
 */
export async function collect(options, deps) {
  const { repo, prNumber, repoDir, callerLane = null, titleLane = null, replay = false, manifestFile = null } = options;
  need(typeof repo === 'string' && REPO.test(repo) && !repo.split('/').some((part) => part === '.' || part === '..'), 'invalid repository name');
  need(Number.isSafeInteger(prNumber) && prNumber > 0, 'invalid pull request number');
  need(typeof repoDir === 'string' && repoDir !== '' && !repoDir.includes('\0'), 'invalid repository directory');
  need(callerLane === null || (typeof callerLane === 'string' && LANE_NAME.test(callerLane)), 'invalid lane name');

  const gh = makeGithub(deps.run);
  return withRefs(deps, repoDir, (git, refs, state) => gather({ repo, prNumber, callerLane, titleLane, replay, manifestFile }, { gh, git, readFile: deps.readFile, refs, state }));
}

// Runs `fn` with the private ref names and deletes the refs it fetched afterwards.
async function withRefs(deps, repoDir, fn) {
  const git = makeGit(deps.run, repoDir);
  const ns = `refs/agent-pipeline-kit/${deps.pid ?? process.pid}`;
  const refs = { trust: `${ns}/trust`, base: `${ns}/base`, head: `${ns}/head` };
  const state = { fetching: false };
  try {
    return await fn(git, refs, state);
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

// One side of a content target: its size, and its bytes unless the size is over
// the cap (then the blob is not read). Throws when git disagrees with itself.
async function readContent(git, sha) {
  need(SHA.test(sha), 'git returned an invalid blob SHA');
  const size = await git.blobSize(sha);
  if (size > CONTENT_MAX_BYTES) return { state: 'present', size, bytes: null };
  const bytes = await git.blob(sha);
  need(bytes.length === size, 'a blob differs from its size');
  return { state: 'present', size, bytes };
}

// The files changed between the merge base and the head, and the contents for
// the content rules.
async function readChanges(git, mergeBase, headSha, manifestText) {
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

  // Contents for the content rules: the merge-base and head blobs of the
  // paths that contentTargets names, by the object ids of the diff itself. A
  // path is defined as an own property, so that a file named `__proto__` is
  // an ordinary key.
  const contents = {};
  const parsedManifest = parseManifest(manifestText);
  if (parsedManifest.ok) {
    const targets = new Set(contentTargets(parsedManifest.manifest, files));
    for (let i = 0; i < files.length; i += 1) {
      if (!targets.has(files[i].path)) continue;
      const { status } = files[i];
      const value = {
        base: status === 'A' ? { state: 'absent' } : await readContent(git, raw[i].srcSha),
        head: status === 'D' ? { state: 'absent' } : await readContent(git, raw[i].dstSha),
      };
      Object.defineProperty(contents, files[i].path, { value, enumerable: true, writable: true, configurable: true });
    }
  }
  return { files, contents };
}

async function gather({ repo, prNumber, callerLane, titleLane, replay, manifestFile }, { gh, git, readFile, refs, state }) {
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

  // 6. Changed files and the contents for the content rules.
  const { files, contents } = await readChanges(git, mergeBase, headSha, manifestText);

  // 7. Queue item at the base tip. The first-parent log is read only when a lane sets a fix-round cap.
  const input = {};
  const parsedManifest = parseManifest(manifestText);
  if (parsedManifest.ok && Object.values(parsedManifest.manifest.lanes).some((lane) => typeof lane.max_fix_rounds === 'number')) {
    input.firstParentLog = await git.firstParentLog(mergeBase, headSha);
  }
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
    const seen = new Set();
    for (const { head, base } of freezes) {
      // The head filter needs an owner, and the live rule ignores the head repository,
      // so filter on the base and match the head branch here.
      for (const p of await gh.paginate(`/repos/${repo}/pulls?state=all&base=${encodeURIComponent(base)}`)) {
        if (p.head?.ref !== head || p.base?.ref !== base || seen.has(p.number)) continue;
        seen.add(p.number);
        pulls.push(pullOf(p, p.closed_at ?? null));
      }
    }
    // Only the latest close time is known, so an item closed and reopened before the
    // merge can look open at the merge time (a false wait, never a false merge).
    if (haltIssues.length > 0 || pulls.length > 0) limits.push('reopen-history-unknown');
  }

  return {
    schema: 1,
    repo,
    manifestText,
    callerLane,
    titleLane,
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
    contents,
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

/**
 * The input of `evaluatePaths`: the diff between a base branch and a head commit
 * that may exist only in the clone.
 * @param {{repo: string, repoDir: string, base: string, head: string, lane?: string|null, item?: string|null, manifestFile?: string|null}} options
 * @param {{run: Function, readFile: (path: string) => Promise<string>, pid?: number}} deps
 * @returns {Promise<{manifestText: string|null, base: {ref: string, sha: string}, mergeBase: string, lane: string|null, item: string|null, files: object[], contents: object}>}
 *          throws on any failed or unexpected API or git result
 */
export async function collectPaths(options, deps) {
  const { repo, repoDir, base, head, lane = null, item = null, manifestFile = null } = options;
  need(typeof repo === 'string' && REPO.test(repo) && !repo.split('/').some((part) => part === '.' || part === '..'), 'invalid repository name');
  need(typeof repoDir === 'string' && repoDir !== '' && !repoDir.includes('\0'), 'invalid repository directory');
  need(isRefName(base), 'invalid base branch name');
  need(typeof head === 'string' && SHA.test(head), 'invalid head SHA');
  need(lane === null || (typeof lane === 'string' && LANE_NAME.test(lane)), 'invalid lane name');
  const gh = makeGithub(deps.run);
  return withRefs(deps, repoDir, async (git, refs, state) => {
    const defaultBranch = (await gh.get(`/repos/${repo}`))?.default_branch;
    need(isRefName(defaultBranch), `invalid ref name for the default branch: ${JSON.stringify(defaultBranch)}`);
    state.fetching = true;
    await git.fetch([`+refs/heads/${defaultBranch}:${refs.trust}`, `+refs/heads/${base}:${refs.base}`]);
    need(await git.resolve(head) === head, 'the head commit is not in the clone');
    const baseSha = await git.resolve(refs.base);
    const manifestText = manifestFile !== null ? await deps.readFile(manifestFile) : await git.textAt(refs.trust, MANIFEST_PATH);
    const mergeBase = await git.mergeBase(baseSha, head);
    const { files, contents } = await readChanges(git, mergeBase, head, manifestText);
    return { manifestText, base: { ref: base, sha: baseSha }, mergeBase, lane, item, files, contents };
  });
}
