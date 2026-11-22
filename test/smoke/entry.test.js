// The program entry: `node src/cli.js` with no arguments must print the usage
// and exit 2. If the entry guard failed to match, the process would print
// nothing and exit 0, which is the exit code of a merge verdict.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const CLI = fileURLToPath(new URL('../../src/cli.js', import.meta.url));

test('program entry: no arguments / run as a program / usage text and exit 2', () => {
  const result = spawnSync(process.execPath, [CLI], { encoding: 'utf8' });
  assert.equal(result.status, 2);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /^unknown command: \(none\)\nusage: agent-pipeline-gate evaluate /);
});
