// Helpers for behaviour scenarios that enter through `main(argv, overrides)`.
// A helper, not a test. The fake world's pull request is clean for the runner
// lane except for the open promotion pull request and the missing Codex
// review, which these overrides settle.

import assert from 'node:assert/strict';
import { main } from '../../src/cli.js';
import { codexSummary } from './baseline.js';
import { makeWorld, SHAS } from './fake-world.js';

export const REPO = 'owner/repo';

export const evaluateArgv = ['evaluate', '--repo', REPO, '--pr', '7', '--repo-dir', '/work/clone'];

// REST overrides: no open promotion pull request, and a clean Codex review of the head.
export const noPromotion = { [`/repos/${REPO}/pulls?state=open`]: [] };
export const codexCleanOn = (sha = SHAS.HEAD) => ({ [`/repos/${REPO}/issues/7/comments`]: [codexSummary({ commit_sha: sha })] });

// The fake world names its private refs after the process id the collector uses.
export const trustManifestKey = `refs/agent-pipeline-kit/${process.pid}/trust:.agent-line/manifest.json`;

/**
 * Runs `main` against the fake world and returns what a caller of the program
 * sees: the exit code, the printed result and the error lines.
 * @param {object} [over] makeWorld overrides; `rest` is merged over the clean defaults
 * @param {string[]} [argv]
 */
export async function gate(over = {}, argv = evaluateArgv) {
  const world = makeWorld({ ...over, pid: process.pid, rest: { ...noPromotion, ...codexCleanOn(), ...over.rest } });
  const out = [];
  const err = [];
  const code = await main(argv, { run: world.run, out: (line) => out.push(line), err: (line) => err.push(line) });
  assert.equal(out.length, 1, 'one printed result');
  return { code, result: JSON.parse(out[0]), err, world };
}
