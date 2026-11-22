// Smoke test of examples/hook-bootstrap.js against real git, with local repositories
// standing in for the consumer's origin and the kit's public remote (no network).
// The kit's cli.js is a stub that reports which commit it came from.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const identity = {
  GIT_AUTHOR_NAME: 'test', GIT_AUTHOR_EMAIL: 'test@example.invalid',
  GIT_COMMITTER_NAME: 'test', GIT_COMMITTER_EMAIL: 'test@example.invalid',
  GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
};
const bootstrap = new URL('../../examples/hook-bootstrap.js', import.meta.url).pathname;
const stub = (name, code) => `let s = ''; for await (const c of process.stdin) s += c;\nprocess.stderr.write('${name} ' + process.argv.slice(2).join(' ') + ' ' + s);\nprocess.exitCode = s.includes('block') ? 2 : ${code};\n`;

let saved;
let root;
let kitUrl;
let consumer;
let pinned;
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

// A fresh consumer clone whose default branch pins `sha` in the manifest.
function makeConsumer(name, sha) {
  const origin = join(root, `${name}.git`);
  mkdirSync(origin);
  git(origin, 'init', '--bare', '-q', '-b', 'main');
  const dir = join(root, name);
  mkdirSync(join(dir, '.agent-line'), { recursive: true });
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'remote', 'add', 'origin', origin);
  writeFileSync(join(dir, '.agent-line/manifest.json'), JSON.stringify({ kit: sha }));
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'pin');
  git(dir, 'push', '-q', 'origin', 'main');
  return dir;
}

before(() => {
  saved = Object.fromEntries(Object.entries(process.env).filter(([k]) => k.startsWith('GIT_')));
  for (const k of Object.keys(saved)) delete process.env[k];
  Object.assign(process.env, identity);
  root = mkdtempSync(join(tmpdir(), 'kit-hook-'));
  const kit = join(root, 'kit');
  mkdirSync(join(kit, 'src'), { recursive: true });
  git(kit, 'init', '-q', '-b', 'main');
  writeFileSync(join(kit, 'src/cli.js'), stub('pinned', 0));
  git(kit, 'add', '-A');
  git(kit, 'commit', '-q', '-m', 'v1');
  pinned = git(kit, 'rev-parse', 'HEAD');
  writeFileSync(join(kit, 'src/cli.js'), stub('later', 0));
  git(kit, 'commit', '-q', '-am', 'v2');
  kitUrl = pathToFileURL(kit).href;
  consumer = makeConsumer('consumer', pinned);
});

after(() => {
  for (const k of Object.keys(process.env)) if (k.startsWith('GIT_')) delete process.env[k];
  Object.assign(process.env, saved);
  rmSync(root, { recursive: true, force: true });
});

const runBootstrap = (dir, input) => spawnSync(process.execPath, [bootstrap, kitUrl], { cwd: dir, input, encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: '' } });

test('bootstrap: manifest pins the first kit commit / the kit has a later commit / the pinned code runs with the stdin and its exit code is kept', () => {
  const allowed = runBootstrap(consumer, '{"tool_name":"x"}');
  assert.equal(allowed.status, 0, allowed.stderr);
  assert.match(allowed.stderr, /^pinned hook --repo-dir \S+ \{"tool_name":"x"\}$/);
  assert.equal(runBootstrap(consumer, 'block').status, 2);
});

test('bootstrap: manifest pins a commit the kit does not have / any call / blocked', () => {
  const dir = makeConsumer('missing-pin', 'a'.repeat(40));
  const result = runBootstrap(dir, '{}');
  assert.equal(result.status, 2);
  assert.match(result.stderr, /^merge blocked: /);
});
