import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseManifest } from '../../src/core/manifest.js';

const valid = () => ({
  schema: 1,
  kit: 'a'.repeat(40),
  checks: ['check'],
  codex_clean: 'no_blocking',
  hold_paths: ['docs/private/**'],
  lanes: {
    runner: {
      kind: 'queue',
      base: 'main',
      auto_merge: true,
      tier: { default: 'auto', strong_review: [] },
      max_changed_lines: null,
      marker: 'Auto-Merged-By: test-runner',
    },
    nightly: {
      kind: 'caller',
      base: 'main',
      auto_merge: true,
      tier: { default: 'hold', auto: ['src/**'], strong_review: [] },
      max_changed_lines: 150,
      marker: 'Auto-Merged-By: test-nightly',
    },
  },
});

const change = (fn) => { const m = valid(); fn(m); return m; };

test('the schema example of the design is valid', () => {
  const design = readFileSync(new URL('../../docs/design.md', import.meta.url), 'utf8');
  const blocks = [...design.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1]);
  const block = blocks.find((b) => b.includes('"schema": 1'));
  assert.ok(block, 'the design has a manifest example');
  const result = parseManifest(block);
  assert.deepEqual(result.ok === false ? result.errors : [], []);
  assert.equal(result.ok, true);
});

test('a valid manifest parses and keeps its values', () => {
  const result = parseManifest(JSON.stringify(valid()));
  assert.equal(result.ok, true);
  assert.deepEqual(result.manifest, valid());
});

test('freeze_while_open is accepted', () => {
  const m = change((x) => { x.lanes.runner.freeze_while_open = { head: 'preview', base: 'main' }; });
  assert.equal(parseManifest(JSON.stringify(m)).ok, true);
});

test('checks "none" is accepted', () => {
  assert.equal(parseManifest(JSON.stringify(change((x) => { x.checks = 'none'; }))).ok, true);
});

test('codex_clean no_findings is accepted', () => {
  assert.equal(parseManifest(JSON.stringify(change((x) => { x.codex_clean = 'no_findings'; }))).ok, true);
});

test('null text is manifest-missing', () => {
  const result = parseManifest(null);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'manifest-missing');
});

test('text that is not JSON is manifest-json', () => {
  for (const text of ['', '{', 'not json', '﻿{}']) {
    const result = parseManifest(text);
    assert.equal(result.ok, false, text);
    assert.equal(result.code, 'manifest-json', text);
  }
});

test('JSON that is not an object is manifest-invalid', () => {
  for (const text of ['[]', 'null', '"x"', '1']) {
    const result = parseManifest(text);
    assert.equal(result.ok, false, text);
    assert.equal(result.code, 'manifest-invalid', text);
  }
});

const invalid = [
  { name: 'wrong schema', fn: (m) => { m.schema = 2; } },
  { name: 'schema as string', fn: (m) => { m.schema = '1'; } },
  { name: 'short kit', fn: (m) => { m.kit = 'a'.repeat(39); } },
  { name: 'uppercase kit', fn: (m) => { m.kit = 'A'.repeat(40); } },
  { name: 'non-hex kit', fn: (m) => { m.kit = 'g'.repeat(40); } },
  { name: 'empty checks', fn: (m) => { m.checks = []; } },
  { name: 'checks other string', fn: (m) => { m.checks = 'all'; } },
  { name: 'checks with an empty name', fn: (m) => { m.checks = ['']; } },
  { name: 'checks with a non-string', fn: (m) => { m.checks = [1]; } },
  { name: 'unknown codex_clean', fn: (m) => { m.codex_clean = 'strict'; } },
  { name: 'invalid hold pattern', fn: (m) => { m.hold_paths = ['a?b']; } },
  { name: 'hold_paths not an array', fn: (m) => { m.hold_paths = 'docs/**'; } },
  { name: 'no lanes', fn: (m) => { m.lanes = {}; } },
  { name: 'two queue lanes', fn: (m) => { m.lanes.nightly.kind = 'queue'; } },
  { name: 'bad lane name (uppercase)', fn: (m) => { m.lanes.Runner = m.lanes.runner; delete m.lanes.runner; } },
  { name: 'bad lane name (leading digit)', fn: (m) => { m.lanes['1x'] = m.lanes.nightly; delete m.lanes.nightly; } },
  { name: 'unknown kind', fn: (m) => { m.lanes.runner.kind = 'interactive'; } },
  { name: 'tier.auto with default auto', fn: (m) => { m.lanes.runner.tier.auto = ['src/**']; } },
  { name: 'empty tier.auto with default auto', fn: (m) => { m.lanes.runner.tier.auto = []; } },
  { name: 'missing tier.auto with default hold', fn: (m) => { delete m.lanes.nightly.tier.auto; } },
  { name: 'unknown tier.default', fn: (m) => { m.lanes.runner.tier.default = 'maybe'; } },
  { name: 'invalid strong_review pattern', fn: (m) => { m.lanes.runner.tier.strong_review = ['[x]']; } },
  { name: 'zero max_changed_lines', fn: (m) => { m.lanes.runner.max_changed_lines = 0; } },
  { name: 'negative max_changed_lines', fn: (m) => { m.lanes.runner.max_changed_lines = -1; } },
  { name: 'fractional max_changed_lines', fn: (m) => { m.lanes.runner.max_changed_lines = 1.5; } },
  { name: 'string max_changed_lines', fn: (m) => { m.lanes.runner.max_changed_lines = '150'; } },
  { name: 'missing max_changed_lines', fn: (m) => { delete m.lanes.runner.max_changed_lines; } },
  { name: 'marker without prefix', fn: (m) => { m.lanes.runner.marker = 'Merged-By: x'; } },
  { name: 'marker with a newline', fn: (m) => { m.lanes.runner.marker = 'Auto-Merged-By: x\nfoo'; } },
  { name: 'marker with a carriage return', fn: (m) => { m.lanes.runner.marker = 'Auto-Merged-By: x\r'; } },
  { name: 'marker with nothing after the prefix', fn: (m) => { m.lanes.runner.marker = 'Auto-Merged-By: '; } },
  { name: 'base with ..', fn: (m) => { m.lanes.runner.base = 'a/../b'; } },
  { name: 'base with a leading -', fn: (m) => { m.lanes.runner.base = '-x'; } },
  { name: 'base with a leading /', fn: (m) => { m.lanes.runner.base = '/x'; } },
  { name: 'base with a space', fn: (m) => { m.lanes.runner.base = 'a b'; } },
  { name: 'empty base', fn: (m) => { m.lanes.runner.base = ''; } },
  { name: 'auto_merge as string', fn: (m) => { m.lanes.runner.auto_merge = 'true'; } },
  { name: 'freeze head with ..', fn: (m) => { m.lanes.runner.freeze_while_open = { head: '..', base: 'main' }; } },
  { name: 'freeze with an extra key', fn: (m) => { m.lanes.runner.freeze_while_open = { head: 'a', base: 'main', x: 1 }; } },
  { name: 'freeze missing base', fn: (m) => { m.lanes.runner.freeze_while_open = { head: 'a' }; } },
  { name: 'unknown top-level key', fn: (m) => { m.extra = 1; } },
  { name: 'unknown lane key', fn: (m) => { m.lanes.runner.extra = 1; } },
  { name: 'unknown tier key', fn: (m) => { m.lanes.runner.tier.extra = 1; } },
  { name: 'missing top-level key', fn: (m) => { delete m.hold_paths; } },
  { name: 'missing lane key', fn: (m) => { delete m.lanes.runner.marker; } },
  { name: 'missing tier.strong_review', fn: (m) => { delete m.lanes.runner.tier.strong_review; } },
];

for (const row of invalid) {
  test(`manifest rejects: ${row.name}`, () => {
    const result = parseManifest(JSON.stringify(change(row.fn)));
    assert.equal(result.ok, false);
    assert.equal(result.code, 'manifest-invalid');
    assert.ok(result.errors.length > 0);
  });
}

test('a __proto__ key is an unknown key', () => {
  const text = '{"schema":1,"__proto__":{"x":1}}';
  const result = parseManifest(text);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'manifest-invalid');
});

test('a __proto__ lane name is rejected', () => {
  const m = valid();
  const text = JSON.stringify(m).replace('"lanes":{', '"lanes":{"__proto__":{},');
  const result = parseManifest(text);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'manifest-invalid');
});
