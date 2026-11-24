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

const readExample = () => readFileSync(new URL('../../examples/manifest.json', import.meta.url), 'utf8');

test('the example manifest is valid', () => {
  const result = parseManifest(readExample());
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

// Content rules (rows M1 to M8).
const ruleSet = () => ({
  hold_on_add_delete: ['docs/specs/**'],
  hold_on_line_change: [{ glob: 'docs/specs/**', pattern: '^Status:' }],
  keys_only: [{ glob: 'tools/*/config.json', keys: ['version'] }],
  front_matter_only: [{ glob: 'docs/guides/**/*.md', keys: ['description'] }],
});
const withRules = (rules) => change((m) => { m.content_rules = rules; });
const parse = (m) => parseManifest(JSON.stringify(m));

test('M1: a manifest without content_rules is valid and has none', () => {
  const result = parse(valid());
  assert.equal(result.ok, true);
  assert.equal(Object.hasOwn(result.manifest, 'content_rules'), false);
});

test('M2: one valid entry of each type, all four, and empty arrays', () => {
  const all = ruleSet();
  for (const rules of [
    {},
    all,
    { hold_on_add_delete: all.hold_on_add_delete },
    { hold_on_line_change: all.hold_on_line_change },
    { keys_only: all.keys_only },
    { front_matter_only: all.front_matter_only },
    { hold_on_add_delete: [], hold_on_line_change: [], keys_only: [], front_matter_only: [] },
    { hold_on_line_change: [{ glob: 'a', pattern: 'x' }, { glob: 'b/**', pattern: 'y$' }], keys_only: [{ glob: 'a', keys: ['k1', 'k2'] }, { glob: 'b', keys: ['k1'] }] },
  ]) {
    const result = parse(withRules(rules));
    assert.deepEqual(result.ok === false ? result.errors : [], [], JSON.stringify(rules));
    assert.deepEqual(result.manifest.content_rules, rules);
  }
});

const badRules = [
  // M3
  ['M3 content_rules is null', null],
  ['M3 content_rules is an array', []],
  ['M3 content_rules is a string', 'rules'],
  ['M3 content_rules is a number', 1],
  ['M3 an unknown key in content_rules', { hold_on_everything: [] }],
  ['M3 an unknown key beside valid ones', { ...ruleSet(), extra: [] }],
  ['M3 hold_on_add_delete is an object', { hold_on_add_delete: {} }],
  ['M3 hold_on_add_delete is a string', { hold_on_add_delete: 'docs/**' }],
  ['M3 hold_on_line_change is null', { hold_on_line_change: null }],
  ['M3 keys_only is an object', { keys_only: { glob: 'a', keys: ['k'] } }],
  ['M3 front_matter_only is a string', { front_matter_only: 'x' }],
  // M4
  ['M4 an entry that is a string', { hold_on_line_change: ['docs/**'] }],
  ['M4 an entry that is null', { keys_only: [null] }],
  ['M4 an entry that is an array', { front_matter_only: [[]] }],
  ['M4 hold_on_line_change without glob', { hold_on_line_change: [{ pattern: 'x' }] }],
  ['M4 hold_on_line_change without pattern', { hold_on_line_change: [{ glob: 'a' }] }],
  ['M4 keys_only without keys', { keys_only: [{ glob: 'a' }] }],
  ['M4 keys_only without glob', { keys_only: [{ keys: ['k'] }] }],
  ['M4 front_matter_only without keys', { front_matter_only: [{ glob: 'a' }] }],
  ['M4 an unknown key in a hold_on_line_change entry', { hold_on_line_change: [{ glob: 'a', pattern: 'x', flags: 'i' }] }],
  ['M4 an unknown key in a keys_only entry', { keys_only: [{ glob: 'a', keys: ['k'], pattern: 'x' }] }],
  ['M4 keys in a hold_on_line_change entry', { hold_on_line_change: [{ glob: 'a', pattern: 'x', keys: ['k'] }] }],
  ['M4 an unknown key in a front_matter_only entry', { front_matter_only: [{ glob: 'a', keys: ['k'], extra: 1 }] }],
  // M5
  ['M5 hold_on_add_delete entry that is a number', { hold_on_add_delete: [1] }],
  ['M5 hold_on_add_delete entry that is an object', { hold_on_add_delete: [{ glob: 'a' }] }],
  ['M5 hold_on_add_delete glob that is empty', { hold_on_add_delete: [''] }],
  ['M5 hold_on_add_delete glob with a leading slash', { hold_on_add_delete: ['/docs/**'] }],
  ...['?', '[', ']', '{', '}', '!', '\\'].map((c) => [`M5 hold_on_add_delete glob with ${c}`, { hold_on_add_delete: [`a${c}b`] }]),
  ['M5 hold_on_line_change glob that is invalid', { hold_on_line_change: [{ glob: 'a?b', pattern: 'x' }] }],
  ['M5 hold_on_line_change glob that is not a string', { hold_on_line_change: [{ glob: 1, pattern: 'x' }] }],
  ['M5 keys_only glob that is invalid', { keys_only: [{ glob: '[a]', keys: ['k'] }] }],
  ['M5 front_matter_only glob that is empty', { front_matter_only: [{ glob: '', keys: ['k'] }] }],
  // M6
  ['M6 pattern empty', { hold_on_line_change: [{ glob: 'a', pattern: '' }] }],
  ['M6 pattern ^', { hold_on_line_change: [{ glob: 'a', pattern: '^' }] }],
  ['M6 pattern $', { hold_on_line_change: [{ glob: 'a', pattern: '$' }] }],
  ['M6 pattern ^$', { hold_on_line_change: [{ glob: 'a', pattern: '^$' }] }],
  ['M6 pattern that is a number', { hold_on_line_change: [{ glob: 'a', pattern: 1 }] }],
  ['M6 pattern that is null', { hold_on_line_change: [{ glob: 'a', pattern: null }] }],
  ['M6 pattern that is an array', { hold_on_line_change: [{ glob: 'a', pattern: ['x'] }] }],
  ['M6 pattern with a newline', { hold_on_line_change: [{ glob: 'a', pattern: 'x\ny' }] }],
  // M7
  ['M7 keys empty', { keys_only: [{ glob: 'a', keys: [] }] }],
  ['M7 keys with a duplicate', { keys_only: [{ glob: 'a', keys: ['k', 'k'] }] }],
  ['M7 keys with an empty string', { front_matter_only: [{ glob: 'a', keys: [''] }] }],
  ['M7 keys with a non-string', { keys_only: [{ glob: 'a', keys: [1] }] }],
  ['M7 keys that is a string', { keys_only: [{ glob: 'a', keys: 'k' }] }],
  ['M7 keys that is null', { front_matter_only: [{ glob: 'a', keys: null }] }],
  ['M7 keys that is an object', { keys_only: [{ glob: 'a', keys: { k: 1 } }] }],
];
for (const [name, rules] of badRules) {
  test(`${name} is invalid`, () => {
    const result = parse(withRules(rules));
    assert.equal(result.ok, false);
    assert.equal(result.code, 'manifest-invalid');
    assert.ok(result.errors.length > 0);
    assert.ok(result.errors.every((e) => typeof e === 'string' && e.length > 0));
    // The manifest is refused for the rule, not because the key is unknown.
    assert.ok(result.errors.some((e) => e.startsWith('content_rules') && !e.includes('unknown key "content_rules"')), result.errors.join('; '));
  });
}

test('M7 a key that differs only by case is a distinct key', () => {
  assert.equal(parse(withRules({ keys_only: [{ glob: 'a', keys: ['version', 'Version'] }] })).ok, true);
});

test('content_rules is not accepted below the top level', () => {
  assert.equal(parse(change((m) => { m.lanes.runner.content_rules = {}; })).ok, false);
});

test('M8: the example manifest contains all four rule types and is valid', () => {
  const example = JSON.parse(readExample());
  assert.deepEqual(Object.keys(example.content_rules).sort(), ['front_matter_only', 'hold_on_add_delete', 'hold_on_line_change', 'keys_only']);
  const result = parse(example);
  assert.deepEqual(result.ok === false ? result.errors : [], []);
  assert.equal(result.ok, true);
});

// Content rule sections_only (rows S1 to S5).
const sectionsEntry = { glob: 'docs/**/*.md', sections: ['## Ready', '## Notes'] };

test('S1: a valid sections_only entry, alone and beside the other rules, and an empty array', () => {
  for (const rules of [
    { sections_only: [sectionsEntry] },
    { sections_only: [] },
    { sections_only: [{ glob: 'a', sections: ['## '] }, { glob: 'b', sections: ['## Ready', '## ready'] }] },
    { ...ruleSet(), sections_only: [sectionsEntry] },
  ]) {
    const result = parse(withRules(rules));
    assert.deepEqual(result.ok === false ? result.errors : [], [], JSON.stringify(rules));
    assert.deepEqual(result.manifest.content_rules, rules);
  }
});

const badSections = [
  ['S2 an entry with keys instead of sections', { sections_only: [{ glob: 'a', keys: ['## A'] }] }],
  ['S3 sections empty', { sections_only: [{ glob: 'a', sections: [] }] }],
  ['S3 sections is a string', { sections_only: [{ glob: 'a', sections: '## A' }] }],
  ['S3 a valid heading beside a number', { sections_only: [{ glob: 'a', sections: ['## A', 2] }] }],
  ['S3 a section with three hashes', { sections_only: [{ glob: 'a', sections: ['### A'] }] }],
  ['S3 a section without the space', { sections_only: [{ glob: 'a', sections: ['##A'] }] }],
  ['S3 a section with a leading space', { sections_only: [{ glob: 'a', sections: [' ## A'] }] }],
  ['S3 a section with a newline', { sections_only: [{ glob: 'a', sections: ['## A\n## B'] }] }],
  ['S3 a section with a carriage return', { sections_only: [{ glob: 'a', sections: ['## A\r'] }] }],
  ['S4 a duplicate section', { sections_only: [{ glob: 'a', sections: ['## A', '## B', '## A'] }] }],
  ['S5 glob with a forbidden character', { sections_only: [{ glob: 'a?b', sections: ['## A'] }] }],
];
for (const [name, rules] of badSections) {
  test(`${name} is invalid`, () => {
    const result = parse(withRules(rules));
    assert.equal(result.ok, false);
    assert.equal(result.code, 'manifest-invalid');
    assert.ok(result.errors.length > 0);
    assert.ok(result.errors.some((e) => e.startsWith('content_rules.sections_only')), result.errors.join('; '));
  });
}

const withPrefixes = (a, b) => {
  const m = valid();
  m.lanes.second = { ...m.lanes.nightly, marker: 'Auto-Merged-By: test-second', title_prefix: b };
  m.lanes.nightly.title_prefix = a;
  return m;
};
const parseObject = (m) => parseManifest(JSON.stringify(m));

test('title_prefix on caller lanes with unrelated prefixes is accepted', () => {
  assert.equal(parseObject(withPrefixes('chore(a): ', 'chore(b): ')).ok, true);
});

test('title_prefix that is empty, multi-line, not a string or on a queue lane is rejected', () => {
  for (const value of ['', 'a\nb', 'a\rb', 3]) {
    const m = valid();
    m.lanes.nightly.title_prefix = value;
    assert.equal(parseObject(m).ok, false, JSON.stringify(value));
  }
  const m = valid();
  m.lanes.runner.title_prefix = 'x: ';
  assert.equal(parseObject(m).ok, false);
});

test('title_prefix values where one starts with the other, or are equal, are rejected', () => {
  for (const [a, b] of [['chore: ', 'chore: ni'], ['chore: ni', 'chore: '], ['chore: ', 'chore: ']]) {
    const result = parseObject(withPrefixes(a, b));
    assert.equal(result.ok, false, `${a} / ${b}`);
    assert.match(result.errors.join('\n'), /overlap/);
  }
});
