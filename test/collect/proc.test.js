import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run } from '../../src/collect/proc.js';

test('proc: an allowed command runs and its output is returned', async () => {
  const result = await run('git', ['--version']);
  assert.equal(result.code, 0);
  assert.match(result.stdout.toString('utf8'), /^git version /);
});

test('proc: a command other than git and gh is refused and never spawned', async () => {
  for (const cmd of ['sh', 'node']) {
    await assert.rejects(run(cmd, ['-e', '0']), new RegExp(`refusing to spawn ${cmd}`));
  }
});
