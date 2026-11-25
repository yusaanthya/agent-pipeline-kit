// Git commands use argument arrays. They leave the worktree untouched and read
// pull request blobs as data.
import { parseNumstat, parseRawDiff } from './parse.js';

const SHA = /^[0-9a-f]{40}$/;
const REF = /^[A-Za-z0-9._/-]+$/;

/** Whether a branch name may be used in a git argument: strict characters, no leading - or /, no "..". */
export const isRefName = (ref) => typeof ref === 'string' && REF.test(ref) && !ref.startsWith('-') &&
  !ref.startsWith('/') && !ref.includes('..');

/**
 * @param {typeof import('./proc.js').run} run
 * @param {string} repoDir a local clone whose `origin` is the repository
 */
export function makeGit(run, repoDir) {
  const exec = (args, options = {}) => run('git', ['-C', repoDir, ...args], { timeoutMs: 120_000, ...options });
  const text = (result) => result.stdout.toString('utf8').trim();

  async function ok(args, options) {
    const result = await exec(args, options);
    if (result.code !== 0) {
      throw new Error(`git ${args[0]} failed (exit ${result.code}): ${result.stderr.toString('utf8').trim().slice(0, 300)}`);
    }
    return result;
  }

  async function sha(args) {
    const out = text(await ok(args));
    if (!SHA.test(out)) throw new Error(`git ${args[0]} returned an unexpected value`);
    return out;
  }

  return {
    async fetch(refspecs) {
      await ok(['fetch', '--no-tags', '--quiet', 'origin', ...refspecs], { timeoutMs: 300_000 });
    },
    resolve: (ref) => sha(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]),
    mergeBase: (a, b) => sha(['merge-base', a, b]),
    async isAncestor(a, b) {
      const result = await exec(['merge-base', '--is-ancestor', a, b]);
      if (result.code === 0) return true;
      if (result.code === 1) return false;
      throw new Error(`git merge-base --is-ancestor failed (exit ${result.code})`);
    },
    async diffRaw(a, b) {
      return parseRawDiff((await ok(['diff', '--raw', '-z', '--no-renames', '--no-abbrev', '--no-ext-diff', '--no-textconv', a, b, '--'])).stdout);
    },
    async diffNumstat(a, b) {
      return parseNumstat((await ok(['diff', '--numstat', '-z', '--no-renames', '--no-ext-diff', '--no-textconv', a, b, '--'])).stdout);
    },
    async blob(objectSha) {
      return (await ok(['cat-file', 'blob', objectSha])).stdout;
    },
    // The size in bytes of a blob, without reading it.
    async blobSize(objectSha) {
      const out = text(await ok(['cat-file', '-s', objectSha]));
      if (!/^\d+$/.test(out) || !Number.isSafeInteger(Number(out))) throw new Error('git cat-file -s returned an unexpected size');
      return Number(out);
    },
    // The file at `<rev>:<path>` as UTF-8 text, or null when it does not exist.
    async textAt(rev, path) {
      const spec = `${rev}:${path}`;
      const exists = await exec(['cat-file', '-e', spec]);
      if (exists.code === 1 || exists.code === 128) return null;
      if (exists.code !== 0) throw new Error(`git cat-file -e failed (exit ${exists.code})`);
      return (await ok(['cat-file', 'blob', spec])).stdout.toString('utf8');
    },
    async lastBefore(ref, isoTime) {
      const out = text(await ok(['rev-list', '-1', '--first-parent', `--before=${isoTime}`, ref]));
      if (out === '') return null;
      if (!SHA.test(out)) throw new Error('git rev-list returned an unexpected value');
      return out;
    },
    async message(commit) {
      return (await ok(['log', '-1', '--format=%B', commit])).stdout.toString('utf8');
    },
    async firstParentLog(mergeBase, head) {
      return (await ok(['log', '--first-parent', '--format=%B', `${mergeBase}..${head}`])).stdout.toString('utf8');
    },
    async deleteRef(ref) {
      try {
        await exec(['update-ref', '-d', ref]);
      } catch {
        // best effort
      }
    },
  };
}
