import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  splitLines, matchLine, changedLines, parseStrictJson, readFrontMatter, evaluateContentRules, contentTargets,
} from '../../src/core/content.js';
import { CONTENT_MAX_BYTES } from '../../src/core/constants.js';
import { baselineManifest, file, addedFile } from '../support/baseline.js';

// L1: splitLines (design 5.4.1, "Lines").
const splitRows = [
  { name: 'two lines, no final newline', text: 'a\nb', expected: ['a', 'b'] },
  { name: 'a final newline adds no phantom line', text: 'a\nb\n', expected: ['a', 'b'] },
  { name: 'an empty file has no lines', text: '', expected: [] },
  { name: 'CRLF loses its carriage return', text: 'a\r\nb', expected: ['a', 'b'] },
  { name: 'a lone carriage return in the middle stays', text: 'a\rb', expected: ['a\rb'] },
  { name: 'blank lines are lines', text: 'a\n\nb', expected: ['a', '', 'b'] },
  { name: 'a trailing blank line counts', text: 'a\n\n', expected: ['a', ''] },
  { name: 'one newline is one empty line', text: '\n', expected: [''] },
  { name: 'only one trailing carriage return is dropped', text: 'a\r\r\nb', expected: ['a\r', 'b'] },
  { name: 'a final line without a newline loses a trailing carriage return', text: 'a\r', expected: ['a'] },
];
for (const row of splitRows) {
  test(`L1 splitLines: ${row.name}`, () => {
    assert.deepEqual(splitLines(row.text), row.expected);
  });
}

// L2: matchLine.
const matchRowsL2 = [
  { pattern: 'Status:', line: 'x Status: y', expected: true },
  { pattern: 'Status:', line: 'Status: y', expected: true },
  { pattern: 'Status:', line: 'status: y', expected: false },
  { pattern: '^Status:', line: 'Status: x', expected: true },
  { pattern: '^Status:', line: ' Status: x', expected: false },
  { pattern: '^Status:', line: 'a Status: x', expected: false },
  { pattern: 'x$', line: 'abx', expected: true },
  { pattern: 'x$', line: 'xa', expected: false },
  { pattern: '^x$', line: 'x', expected: true },
  { pattern: '^x$', line: 'xx', expected: false },
  { pattern: '^x$', line: ' x', expected: false },
  { pattern: 'a.c', line: 'abc', expected: false },
  { pattern: 'a.c', line: 'a.c', expected: true },
  { pattern: 'a*', line: 'aaa', expected: false },
  { pattern: 'a*', line: 'a*', expected: true },
  { pattern: 'a\\b', line: 'a\\b', expected: true },
  { pattern: 'a\\b', line: 'ab', expected: false },
  { pattern: '^^', line: '^x', expected: true },
  { pattern: '^^', line: 'x', expected: false },
  { pattern: '$$', line: 'x$', expected: true },
  { pattern: 'a^b', line: 'a^b', expected: true },
];
for (const row of matchRowsL2) {
  test(`L2 matchLine ${JSON.stringify(row.pattern)} against ${JSON.stringify(row.line)}`, () => {
    assert.equal(matchLine(row.pattern, row.line), row.expected);
  });
}

// L3 and L4: changedLines.
const P = '^Status:';
const changedRows = [
  { name: 'L3 a matching line added', base: 'a\n', head: 'a\nStatus: x\n', expected: true },
  { name: 'L3 a matching line removed', base: 'a\nStatus: x\n', head: 'a\n', expected: true },
  { name: 'L3 a matching line edited', base: 'Status: a\n', head: 'Status: b\n', expected: true },
  { name: 'L3 a matching line moved only', base: 'Status: a\nx\n', head: 'x\nStatus: a\n', expected: false },
  { name: 'L3 a matching line duplicated, 1 to 2', base: 'Status: a\n', head: 'Status: a\nStatus: a\n', expected: true },
  { name: 'L3 a matching line deduplicated, 2 to 1', base: 'Status: a\nStatus: a\n', head: 'Status: a\n', expected: true },
  { name: 'L3 no matching line on either side', base: 'a\n', head: 'b\n', expected: false },
  { name: 'L3 identical files', base: 'Status: a\nx\n', head: 'Status: a\nx\n', expected: false },
  { name: 'L3 carriage returns are not part of the line', base: 'Status: a\r\n', head: 'Status: a\n', expected: false },
  { name: 'L3 a non-matching line changes beside a matching one', base: 'Status: a\nx\n', head: 'Status: a\ny\n', expected: false },
  { name: 'L4 base absent, head has a matching line', base: null, head: 'Status: x\n', expected: true },
  { name: 'L4 base absent, head has none', base: null, head: 'x\n', expected: false },
  { name: 'L4 head absent, base has a matching line', base: 'Status: x\n', head: null, expected: true },
  { name: 'L4 head absent, base has none', base: 'x\n', head: null, expected: false },
  { name: 'L4 both absent', base: null, head: null, expected: false },
  { name: 'L4 an empty head against a matching base', base: 'Status: x\n', head: '', expected: true },
];
for (const row of changedRows) {
  test(`${row.name}`, () => {
    assert.equal(changedLines(P, row.base, row.head), row.expected);
  });
}

// parseStrictJson: object top level, no BOM, no duplicate key at any depth.
const jsonOk = [
  { name: 'an empty object', text: '{}', value: {} },
  { name: 'whitespace and key order are irrelevant to validity', text: ' {\n "b": 1,\t"a": [1, {"c": null}] }\n', value: { b: 1, a: [1, { c: null }] } },
  { name: 'the same key in different objects', text: '{"a":{"x":1},"b":{"x":2},"c":[{"x":1},{"x":2}]}', value: { a: { x: 1 }, b: { x: 2 }, c: [{ x: 1 }, { x: 2 }] } },
  { name: 'a key text inside a string value', text: '{"a":"\\"a\\":1,\\"a\\":2"}', value: { a: '"a":1,"a":2' } },
];
for (const row of jsonOk) {
  test(`parseStrictJson accepts ${row.name}`, () => {
    assert.deepEqual(parseStrictJson(row.text), { ok: true, value: row.value });
  });
}
const jsonBad = [
  { name: 'text that is not JSON', text: 'nope' },
  { name: 'an empty text', text: '' },
  { name: 'trailing garbage', text: '{} x' },
  { name: 'an array top level', text: '[1]' },
  { name: 'a null top level', text: 'null' },
  { name: 'a number top level', text: '1' },
  { name: 'a string top level', text: '"a"' },
  { name: 'a byte-order mark', text: '\uFEFF{}' },
  { name: 'a duplicate key at depth 1', text: '{"a":1,"a":2}' },
  { name: 'a duplicate key at depth 3', text: '{"x":{"y":{"a":1,"a":2}}}' },
  { name: 'a duplicate key inside an array element', text: '{"x":[{"a":1,"a":2}]}' },
  { name: 'a duplicate key written with an escape', text: '{"a":1,"\\u0061":2}' },
  { name: 'a duplicate key after a nested object', text: '{"a":{"b":1},"c":2,"a":3}' },
  { name: 'a trailing comma', text: '{"a":1,}' },
];
for (const row of jsonBad) {
  test(`parseStrictJson rejects ${row.name}`, () => {
    assert.deepEqual(parseStrictJson(row.text), { ok: false });
  });
}
test('parseStrictJson does not throw on a very deeply nested text', () => {
  assert.doesNotThrow(() => parseStrictJson(`{"a":${'['.repeat(200000)}${']'.repeat(200000)}}`));
});

// readFrontMatter.
const fm = (text) => {
  const result = readFrontMatter(text);
  return result.ok ? { ok: true, blocks: Object.fromEntries(result.blocks) } : result;
};
const fmRows = [
  { name: 'null has no front matter', text: null, expected: { ok: true, blocks: {} } },
  { name: 'a text without the opener has none', text: 'hello\n', expected: { ok: true, blocks: {} } },
  { name: 'an empty text has none', text: '', expected: { ok: true, blocks: {} } },
  { name: 'a leading form feed before the opener is malformed', text: '\f---\na: 1\n---\n', expected: { ok: false } },
  { name: 'an empty front matter', text: '---\n---\nbody', expected: { ok: true, blocks: {} } },
  { name: 'two keys', text: '---\na: 1\nb: two\n---\nbody\n', expected: { ok: true, blocks: { a: 'a: 1', b: 'b: two' } } },
  { name: 'a closing line without a final newline', text: '---\na: 1\n---', expected: { ok: true, blocks: { a: 'a: 1' } } },
  { name: 'list-form continuation lines belong to their key', text: '---\ntags:\n  - x\n- y\n\tz\n\nname: n\n---\n', expected: { ok: true, blocks: { tags: 'tags:\n  - x\n- y\n\tz\n', name: 'name: n' } } },
  { name: 'a blank line before the first key is allowed', text: '---\n\na: 1\n---\n', expected: { ok: true, blocks: { a: 'a: 1' } } },
  { name: 'a key with a hyphen, digits and an underscore', text: '---\n_a-1_b: v\n---\n', expected: { ok: true, blocks: { '_a-1_b': '_a-1_b: v' } } },
  { name: 'a key line without a space after the colon', text: '---\na:1\n---\n', expected: { ok: true, blocks: { a: 'a:1' } } },
  { name: 'only the first closing line closes', text: '---\na: 1\n---\nb: 2\n---\n', expected: { ok: true, blocks: { a: 'a: 1' } } },
  { name: 'an opener with a trailing space', text: '--- \na: 1\n---\n', expected: { ok: false } },
  { name: 'an opener with a language tag', text: '---yaml\na: 1\n---\n', expected: { ok: false } },
  { name: 'a four-hyphen opener', text: '----\na: 1\n---\n', expected: { ok: false } },
  { name: 'a CRLF opener', text: '---\r\na: 1\r\n---\r\n', expected: { ok: false } },
  { name: 'no closing line', text: '---\na: 1\nbody\n', expected: { ok: false } },
  { name: 'an opener alone', text: '---', expected: { ok: false } },
  { name: 'an opener and a newline only', text: '---\n', expected: { ok: false } },
  { name: 'a closing line with a trailing space does not close', text: '---\na: 1\n--- \n', expected: { ok: false } },
  { name: 'a carriage return inside', text: '---\na: 1\rb\n---\n', expected: { ok: false } },
  { name: 'a carriage return at the end of a line inside', text: '---\na: 1\r\n---\n', expected: { ok: false } },
  { name: 'a comment line at column 0', text: '---\n# c\na: 1\n---\n', expected: { ok: false } },
  { name: 'a comment line between keys', text: '---\na: 1\n# c\nb: 2\n---\n', expected: { ok: false } },
  { name: 'a quoted key', text: '---\n"a": 1\n---\n', expected: { ok: false } },
  { name: 'a repeated key', text: '---\na: 1\na: 2\n---\n', expected: { ok: false } },
  { name: 'a stray line before the first key', text: '---\nstray\na: 1\n---\n', expected: { ok: false } },
  { name: 'a line of spaces before the first key', text: '---\n \na: 1\n---\n', expected: { ok: false } },
  { name: 'a stray word at column 0 after a key', text: '---\na: 1\nstray\n---\n', expected: { ok: false } },
  { name: 'a bare hyphen at column 0', text: '---\na: 1\n-\n---\n', expected: { ok: false } },
  { name: 'a key starting with a hyphen', text: '---\n-a: 1\n---\n', expected: { ok: false } },
  { name: 'a key with a space', text: '---\na b: 1\n---\n', expected: { ok: false } },
];
for (const row of fmRows) {
  test(`readFrontMatter: ${row.name}`, () => {
    assert.deepEqual(fm(row.text), row.expected);
  });
}

// Exactness of numbers in parsed values.
test('parseStrictJson keeps a number that a double cannot hold distinct from its neighbour', () => {
  const a = parseStrictJson('{"n":9007199254740992}');
  const b = parseStrictJson('{"n":9007199254740993}');
  assert.equal(a.ok && b.ok, true);
  assert.notDeepEqual(a.value, b.value);
});
test('parseStrictJson accepts a number beyond the range of a double', () => {
  assert.equal(parseStrictJson('{"n":1e400}').ok, true);
});

// Rules, through evaluateContentRules.
const enc = (text) => new TextEncoder().encode(text);
const present = (text) => { const bytes = enc(text); return { state: 'present', size: bytes.length, bytes }; };
const presentBytes = (bytes) => ({ state: 'present', size: bytes.length, bytes: Uint8Array.from(bytes) });
const absent = { state: 'absent' };
const overCap = { state: 'present', size: CONTENT_MAX_BYTES + 1, bytes: null };
const deleted = (path) => file(path, { status: 'D', headMode: null, headHasNul: null });
const manifestWith = (rules) => ({ ...baselineManifest(), content_rules: rules });
const hold = (code, path, word) => ({ verdict: 'hold:owner', code, detail: `${path}: ${word}` });
const missing = (path) => ({ verdict: 'blocked:input', code: 'content-missing', detail: path });
const sides = (f, base, head) => ({ [f.path]: {
  base: base === undefined ? (f.status === 'A' ? absent : present('')) : (typeof base === 'string' ? present(base) : base),
  head: head === undefined ? (f.status === 'D' ? absent : present('')) : (typeof head === 'string' ? present(head) : head),
} });
const evalOne = (rules, f, base, head) => evaluateContentRules(manifestWith(rules), [f], sides(f, base, head));

// Every reason of every row below is checked against the closed vocabulary: a
// reason names a path and one word, and never a line, a key or other file text.
const WORDS = ['added', 'deleted', 'line-changed', 'key-changed', 'front-matter-invalid', 'front-matter-changed', 'unreadable'];
const SENTINEL = 'ZZ-SECRET-LINE-ZZ';
function checkVocabulary(reasons, f) {
  for (const reason of reasons) {
    if (reason.code === 'content-missing') {
      assert.deepEqual(reason, missing(f.path));
      continue;
    }
    assert.equal(reason.verdict, 'hold:owner');
    assert.ok(['rule-add-delete', 'rule-line-change', 'rule-keys', 'rule-front-matter'].includes(reason.code), reason.code);
    assert.ok(reason.detail.startsWith(`${f.path}: `), reason.detail);
    assert.ok(WORDS.includes(reason.detail.slice(f.path.length + 2)), reason.detail);
    assert.deepEqual(Object.keys(reason).sort(), ['code', 'detail', 'verdict']);
  }
}
function run(name, rules, f, base, head, expected) {
  test(name, () => {
    const reasons = evalOne(rules, f, base, head);
    assert.deepEqual(reasons, expected);
    checkVocabulary(reasons, f);
  });
}

// A1 to A3: hold_on_add_delete.
const AD = { hold_on_add_delete: ['docs/**'] };
test('A1 hold_on_add_delete reads no contents', () => {
  assert.deepEqual(evaluateContentRules(manifestWith(AD), [addedFile('docs/a.md')], undefined), [hold('rule-add-delete', 'docs/a.md', 'added')]);
});
run('A1 added under the glob', AD, addedFile('docs/a.md'), undefined, undefined, [hold('rule-add-delete', 'docs/a.md', 'added')]);
run('A1 deleted under the glob', AD, deleted('docs/a.md'), undefined, undefined, [hold('rule-add-delete', 'docs/a.md', 'deleted')]);
run('A1 modified under the glob', AD, file('docs/a.md'), undefined, undefined, []);
run('A1 added outside the glob', AD, addedFile('src/a.md'), undefined, undefined, []);
run('A1 glob matched in a different case', AD, addedFile('Docs/A.md'), undefined, undefined, [hold('rule-add-delete', 'Docs/A.md', 'added')]);
run('A3 a type change is not evaluated', AD, file('docs/a.md', { status: 'T' }), undefined, undefined, []);
run('A3 an added executable is not evaluated by a content rule', AD, addedFile('docs/a.md', { headMode: '100755', headHasNul: null }), undefined, undefined, []);
run('A1 two rules matching one entry give two reasons in array order', { hold_on_add_delete: ['docs/**', '**/*.md'] },
  addedFile('docs/a.md'), undefined, undefined, [hold('rule-add-delete', 'docs/a.md', 'added'), hold('rule-add-delete', 'docs/a.md', 'added')]);
test('A2 a rename inside the glob holds twice, in diff order', () => {
  const files = [deleted('docs/a.md'), addedFile('docs/b.md')];
  assert.deepEqual(evaluateContentRules(manifestWith(AD), files, {}), [
    hold('rule-add-delete', 'docs/a.md', 'deleted'), hold('rule-add-delete', 'docs/b.md', 'added'),
  ]);
});
test('A2 a rename out of the glob holds once', () => {
  assert.deepEqual(evaluateContentRules(manifestWith(AD), [deleted('docs/a.md'), addedFile('src/b.md')], {}), [hold('rule-add-delete', 'docs/a.md', 'deleted')]);
});
test('A2 a rename into the glob holds once', () => {
  assert.deepEqual(evaluateContentRules(manifestWith(AD), [deleted('src/a.md'), addedFile('docs/b.md')], {}), [hold('rule-add-delete', 'docs/b.md', 'added')]);
});

// N1 and N2: hold_on_line_change.
const LC = { hold_on_line_change: [{ glob: 'docs/**', pattern: '^Status:' }] };
const doc = file('docs/s.md');
const lineRows = [
  ['a matching line added', 'a\n', 'a\nStatus: x\n', true],
  ['a matching line removed', 'a\nStatus: x\n', 'a\n', true],
  ['a matching line edited', 'Status: a\n', 'Status: b\n', true],
  ['a matching line moved only', 'Status: a\nx\n', 'x\nStatus: a\n', false],
  ['a matching line duplicated', 'Status: a\n', 'Status: a\nStatus: a\n', true],
  ['a matching line deduplicated', 'Status: a\nStatus: a\n', 'Status: a\n', true],
  ['no matching line', 'a\n', 'b\n', false],
  ['identical files', 'Status: a\n', 'Status: a\n', false],
];
for (const [name, base, head, changed] of lineRows) {
  run(`N1 ${name}`, LC, doc, base, head, changed ? [hold('rule-line-change', 'docs/s.md', 'line-changed')] : []);
}
run('N1 an added file contributes every head line', LC, addedFile('docs/s.md'), undefined, 'x\nStatus: new\n', [hold('rule-line-change', 'docs/s.md', 'line-changed')]);
run('N1 an added file without a matching line', LC, addedFile('docs/s.md'), undefined, 'x\n', []);
run('N1 a deleted file contributes every base line', LC, deleted('docs/s.md'), 'Status: old\n', undefined, [hold('rule-line-change', 'docs/s.md', 'line-changed')]);
run('N1 a file outside the glob is not read', LC, file('src/s.md'), 'a\n', 'Status: x\n', []);
run('N1 a type change is not evaluated', LC, file('docs/s.md', { status: 'T' }), 'a\n', 'Status: x\n', []);
run('N1 two rules over one file give a reason per rule', {
  hold_on_line_change: [{ glob: 'docs/**', pattern: '^Status:' }, { glob: '**/*.md', pattern: 'Date:' }, { glob: 'docs/**', pattern: 'Owner:' }],
}, doc, 'Status: a\nDate: 1\nOwner: me\n', 'Status: b\nDate: 2\nOwner: me\n', [
  hold('rule-line-change', 'docs/s.md', 'line-changed'), hold('rule-line-change', 'docs/s.md', 'line-changed'),
]);
const unreadable = [
  ['a blob over the cap', overCap],
  ['invalid UTF-8', presentBytes([0x53, 0xff, 0x3a])],
  ['a truncated UTF-8 sequence', presentBytes([0x53, 0xe2, 0x82])],
  ['a NUL byte', presentBytes([0x53, 0x00, 0x3a])],
  ['a blob over the cap with bytes supplied anyway', { state: 'present', size: CONTENT_MAX_BYTES + 1, bytes: new Uint8Array(CONTENT_MAX_BYTES + 1).fill(0x61) }],
];
for (const [name, side] of unreadable) {
  run(`N2 ${name} at the head`, LC, doc, 'Status: a\n', side, [hold('rule-line-change', 'docs/s.md', 'unreadable')]);
  run(`N2 ${name} at the base`, LC, doc, side, 'Status: a\n', [hold('rule-line-change', 'docs/s.md', 'unreadable')]);
}
run('N2 a blob of exactly the cap is readable', LC, doc, 'Status: a\n', (() => {
  const bytes = new Uint8Array(CONTENT_MAX_BYTES).fill(0x61);
  bytes.set(enc('Status: a\n'));
  return { state: 'present', size: bytes.length, bytes };
})(), []);

// K1 to K6: keys_only.
const KO = { keys_only: [{ glob: 'tools/*/config.json', keys: ['version'] }] };
const cfg = file('tools/a/config.json');
const keyRows = [
  // [name, base, head, expected word or null]
  ['K1 only a named key changed', '{"version":1,"x":2}', '{"version":2,"x":2}', null],
  ['K1 a named key added', '{"x":2}', '{"version":1,"x":2}', null],
  ['K1 a named key removed', '{"version":1,"x":2}', '{"x":2}', null],
  ['K1 reformatted only', '{"version":1,"x":2}', '{\n  "version": 1,\n  "x": 2\n}\n', null],
  ['K1 key order changed', '{"version":1,"x":2}', '{"x":2,"version":1}', null],
  ['K2 an unnamed key changed', '{"version":1,"x":2}', '{"version":1,"x":3}', 'key-changed'],
  ['K2 an unnamed key added', '{"version":1}', '{"version":1,"y":1}', 'key-changed'],
  ['K2 an unnamed key removed', '{"version":1,"x":2}', '{"version":1}', 'key-changed'],
  ['K2 a nested value of an unnamed key changed', '{"x":{"a":1}}', '{"x":{"a":2}}', 'key-changed'],
  ['K2 a nested key of an unnamed key added', '{"x":{"a":1}}', '{"x":{"a":1,"b":1}}', 'key-changed'],
  ['K2 array order changed', '{"x":[1,2]}', '{"x":[2,1]}', 'key-changed'],
  ['K2 an array element added', '{"x":[1]}', '{"x":[1,2]}', 'key-changed'],
  ['K2 a string against a number', '{"x":"1"}', '{"x":1}', 'key-changed'],
  ['K2 null against a missing key', '{"x":null}', '{}', 'key-changed'],
  ['K2 true against 1', '{"x":true}', '{"x":1}', 'key-changed'],
  ['K2 a named key changes with an unnamed key', '{"version":1,"x":2}', '{"version":2,"x":3}', 'key-changed'],
  ['K3 numbers 1 and 1.0', '{"x":1}', '{"x":1.0}', null],
  ['K3 numbers 1 and 1e0', '{"x":1}', '{"x":1e0}', null],
  ['K3 numbers 100 and 1E2', '{"x":100}', '{"x":1E2}', null],
  ['K3 numbers 0.1 and 0.10', '{"x":0.1}', '{"x":0.10}', null],
  ['K3 numbers 0 and -0', '{"x":0}', '{"x":-0}', null],
  ['K3 numbers 1.5e1 and 15', '{"x":1.5e1}', '{"x":15}', null],
  ['K3 objects equal with different key order', '{"x":{"a":1,"b":{"c":1,"d":2}}}', '{"x":{"b":{"d":2,"c":1},"a":1}}', null],
  ['K3 numbers that differ beyond a double', '{"x":9007199254740992}', '{"x":9007199254740993}', 'key-changed'],
  ['K3 numbers that differ beyond a double, inside an array', '{"x":[0.1000000000000000055511151231257827]}', '{"x":[0.1]}', 'key-changed'],
  ['K3 numbers beyond the range of a double that differ', '{"x":1e400}', '{"x":2e400}', 'key-changed'],
  ['K3 equal numbers beyond the range of a double', '{"x":1e400}', '{"x":10e399}', null],
  ['K3 a huge number against a double', '{"x":1e400}', '{"x":1e308}', 'key-changed'],
  ['K3 a key named __proto__ is an ordinary key', '{"__proto__":1}', '{"__proto__":2}', 'key-changed'],
  ['K3 a key named __proto__ unchanged', '{"__proto__":{"a":1}}', '{"__proto__":{"a":1}}', null],
];
for (const [name, base, head, word] of keyRows) {
  run(name, KO, cfg, base, head, word === null ? [] : [hold('rule-keys', 'tools/a/config.json', word)]);
}
run('K4 an added file', KO, addedFile('tools/a/config.json'), undefined, '{"version":1}', [hold('rule-keys', 'tools/a/config.json', 'added')]);
run('K4 a deleted file', KO, deleted('tools/a/config.json'), '{"version":1}', undefined, [hold('rule-keys', 'tools/a/config.json', 'deleted')]);
const badJson = [
  ['not JSON', 'nope'],
  ['an empty file', ''],
  ['a top-level array', '[{"version":1}]'],
  ['a top-level null', 'null'],
  ['a byte-order mark', '﻿{"version":1}'],
  ['a duplicate key at depth 1', '{"version":1,"version":2}'],
  ['a duplicate unnamed key at depth 1', '{"x":1,"x":1}'],
  ['a duplicate key at depth 3', '{"x":{"y":{"a":1,"a":2}}}'],
];
for (const [name, text] of badJson) {
  run(`K5 head: ${name}`, KO, cfg, '{"version":1}', text, [hold('rule-keys', 'tools/a/config.json', 'unreadable')]);
  run(`K5 base: ${name}`, KO, cfg, text, '{"version":1}', [hold('rule-keys', 'tools/a/config.json', 'unreadable')]);
}
for (const [name, side] of unreadable) {
  run(`K5 head: ${name}`, KO, cfg, '{"version":1}', side, [hold('rule-keys', 'tools/a/config.json', 'unreadable')]);
}
run('K6 an added file whose head is not JSON', KO, addedFile('tools/a/config.json'), undefined, 'nope', [hold('rule-keys', 'tools/a/config.json', 'added')]);
run('K6 an added file whose head has a leading U+FEFF', KO, addedFile('tools/a/config.json'), undefined, '﻿{"version":1}', [hold('rule-keys', 'tools/a/config.json', 'added')]);
run('K6 a deleted file whose base has a duplicate key', KO, deleted('tools/a/config.json'), '{"a":1,"a":2}', undefined, [hold('rule-keys', 'tools/a/config.json', 'deleted')]);
run('K6 a deleted file whose base is over the cap', KO, deleted('tools/a/config.json'), overCap, undefined, [hold('rule-keys', 'tools/a/config.json', 'deleted')]);
run('K6 an added file whose head has a NUL byte', KO, addedFile('tools/a/config.json'), undefined, presentBytes([0x7b, 0, 0x7d]), [hold('rule-keys', 'tools/a/config.json', 'added')]);
run('K1 a file outside the glob is not read', KO, file('tools/a/b/config.json'), '{"x":1}', '{"x":2}', []);
run('K1 two rules give a reason per rule, in array order', {
  keys_only: [{ glob: 'tools/**', keys: ['x'] }, { glob: 'tools/*/config.json', keys: ['version'] }],
}, cfg, '{"version":1,"x":1}', '{"version":2,"x":2}', [
  hold('rule-keys', 'tools/a/config.json', 'key-changed'), hold('rule-keys', 'tools/a/config.json', 'key-changed'),
]);
test('K3 deeply nested values compare without throwing', () => {
  const nested = (depth, leaf) => `{"x":${'['.repeat(depth)}${leaf}${']'.repeat(depth)}}`;
  assert.deepEqual(evalOne(KO, cfg, nested(200, '1'), nested(200, '1')), []);
  assert.deepEqual(evalOne(KO, cfg, nested(200, '1'), nested(200, '2')), [hold('rule-keys', 'tools/a/config.json', 'key-changed')]);
  // Beyond what the parser accepts the file is unreadable, which holds.
  const deep = evalOne(KO, cfg, nested(200000, '1'), nested(200000, '1'));
  assert.equal(deep.length <= 1, true);
  assert.ok(deep.every((r) => r.code === 'rule-keys'));
});

// F1 to F8, B1 to B5: front_matter_only.
const FM = { front_matter_only: [{ glob: 'docs/guides/**/*.md', keys: ['description'] }] };
const guide = file('docs/guides/a.md');
const base0 = '---\nname: x\ndescription: old\n---\nbody\n';
const fmRowsRules = [
  ['F1 only a named key changed', base0, '---\nname: x\ndescription: new\n---\nbody\n', null],
  ['F1 a named key added', '---\nname: x\n---\nbody\n', '---\nname: x\ndescription: new\n---\nbody\n', null],
  ['F1 a named key removed', base0, '---\nname: x\n---\nbody\n', null],
  ['F1 a named key in list form changes', '---\nname: x\ndescription:\n  - a\n---\n', '---\nname: x\ndescription:\n  - a\n  - b\n---\n', null],
  ['F1 a named key moves to the front', base0, '---\ndescription: old\nname: x\n---\nbody\n', null],
  ['F2 an unnamed key value changed', base0, '---\nname: y\ndescription: old\n---\nbody\n', 'front-matter-changed'],
  ['F2 list-form continuation lines changed', '---\ntags:\n  - a\ndescription: d\n---\n', '---\ntags:\n  - a\n  - b\ndescription: d\n---\n', 'front-matter-changed'],
  ['F2 a continuation line indented differently', '---\ntags:\n  - a\n---\n', '---\ntags:\n    - a\n---\n', 'front-matter-changed'],
  ['F2 a key added', base0, '---\nname: x\nextra: 1\ndescription: old\n---\nbody\n', 'front-matter-changed'],
  ['F2 a key removed', base0, '---\ndescription: old\n---\nbody\n', 'front-matter-changed'],
  ['F2 a blank line added to an unnamed block', '---\nname: x\n---\n', '---\nname: x\n\n---\n', 'front-matter-changed'],
  ['F2 an unnamed key renamed', base0, '---\nnamee: x\ndescription: old\n---\nbody\n', 'front-matter-changed'],
  ['F3 the body edited only', base0, '---\nname: x\ndescription: old\n---\nentirely different body\n', null],
  ['F3 the body gains a front-matter-like block', base0, `${base0}---\nname: z\n---\n`, null],
  ['F3 neither side has front matter', 'hello\n', 'world\n', null],
  ['F3 a front matter line ending that differs outside the front matter', base0, base0.replace('body\n', 'body\r\nmore\r\n'), null],
  ['F5 a leading form feed before the opener is malformed', base0, `\f${base0}`, 'front-matter-invalid'],
  ['F5 a changed opener cannot hide a key', base0, base0.replace('---\nname', '--- \nname'), 'front-matter-invalid'],
  ['F6 the base ill-formed and the head identical', '---\nname: x\n', '---\nname: x\n', 'front-matter-invalid'],
  ['F6 the base ill-formed, the head well-formed', '---\n# c\nname: x\n---\n', base0, 'front-matter-invalid'],
];
for (const [name, base, head, word] of fmRowsRules) {
  run(name, FM, guide, base, head, word === null ? [] : [hold('rule-front-matter', 'docs/guides/a.md', word)]);
}
const badHeads = [
  ['an opener with a trailing space', '--- \nname: x\n---\n'],
  ['an opener with a language tag', '---yaml\nname: x\n---\n'],
  ['a four-hyphen opener', '----\nname: x\n---\n'],
  ['a CRLF opener', '---\r\nname: x\r\n---\r\n'],
  ['no closing line', '---\nname: x\nbody\n'],
  ['a carriage return inside', '---\nname: x\r\n---\n'],
  ['a comment line at column 0', '---\n# c\nname: x\n---\n'],
  ['a quoted key', '---\n"name": x\n---\n'],
  ['a repeated key', '---\nname: x\nname: y\n---\n'],
  ['a stray line before the first key', '---\nstray\nname: x\n---\n'],
];
for (const [name, head] of badHeads) {
  run(`F4 head: ${name}`, FM, guide, base0, head, [hold('rule-front-matter', 'docs/guides/a.md', 'front-matter-invalid')]);
  run(`F4 an added file: ${name}`, FM, addedFile('docs/guides/a.md'), undefined, head, [hold('rule-front-matter', 'docs/guides/a.md', 'front-matter-invalid')]);
  run(`F4 a deleted file: ${name}`, FM, deleted('docs/guides/a.md'), head, undefined, [hold('rule-front-matter', 'docs/guides/a.md', 'front-matter-invalid')]);
}
run('F7 an added file with only named keys', FM, addedFile('docs/guides/a.md'), undefined, '---\ndescription: x\n---\nbody\n', []);
run('F7 an added file with no front matter', FM, addedFile('docs/guides/a.md'), undefined, 'body\n', []);
run('F7 an added file with another key', FM, addedFile('docs/guides/a.md'), undefined, '---\nname: x\n---\n', [hold('rule-front-matter', 'docs/guides/a.md', 'front-matter-changed')]);
run('F7 a deleted file with another key', FM, deleted('docs/guides/a.md'), base0, undefined, [hold('rule-front-matter', 'docs/guides/a.md', 'front-matter-changed')]);
run('F7 a deleted file with only named keys', FM, deleted('docs/guides/a.md'), '---\ndescription: x\n---\n', undefined, []);
run('B1 an added file whose head is U+FEFF then a front matter', { front_matter_only: [{ glob: 'docs/**', keys: ['description'] }] },
  addedFile('docs/a.md'), undefined, '﻿---\nname: x\n---\n', [hold('rule-front-matter', 'docs/a.md', 'unreadable')]);
run('B2 a modified file whose head gains a leading U+FEFF', FM, guide, base0, `﻿${base0}`, [hold('rule-front-matter', 'docs/guides/a.md', 'unreadable')]);
run('B2 a modified file whose base has a leading U+FEFF', FM, guide, `﻿${base0}`, base0, [hold('rule-front-matter', 'docs/guides/a.md', 'unreadable')]);
for (const [name, side] of unreadable) {
  run(`F8 ${name} at the head`, FM, guide, base0, side, [hold('rule-front-matter', 'docs/guides/a.md', 'unreadable')]);
  run(`F8 ${name} at the base`, FM, guide, side, base0, [hold('rule-front-matter', 'docs/guides/a.md', 'unreadable')]);
}
run('F8 an unreadable added file', FM, addedFile('docs/guides/a.md'), undefined, presentBytes([0xff]), [hold('rule-front-matter', 'docs/guides/a.md', 'unreadable')]);
run('F8 an unreadable file beats a malformed one', FM, guide, base0, presentBytes([0x2d, 0x2d, 0x2d, 0xff]), [hold('rule-front-matter', 'docs/guides/a.md', 'unreadable')]);

// B3 and B4: a leading U+FEFF under the other types; B5: not at the start.
run('B3 a head whose first line is U+FEFF then a matching line', LC, doc, 'Status: a\n', '﻿Status: x\n', [hold('rule-line-change', 'docs/s.md', 'unreadable')]);
run('B3 the same on the base side only', LC, doc, '﻿Status: x\n', 'Status: x\n', [hold('rule-line-change', 'docs/s.md', 'unreadable')]);
run('B3 an added file with a leading U+FEFF', LC, addedFile('docs/s.md'), undefined, '﻿x\n', [hold('rule-line-change', 'docs/s.md', 'unreadable')]);
run('B4 a keys_only head that begins with U+FEFF', KO, cfg, '{"version":1}', '﻿{"version":2}', [hold('rule-keys', 'tools/a/config.json', 'unreadable')]);
run('B5 a U+FEFF inside a line is evaluated as text (line change)', LC, doc, 'x\nStatus: 1\n', 'x\nStatus: ﻿1\n', [hold('rule-line-change', 'docs/s.md', 'line-changed')]);
run('B5 a U+FEFF inside a line is evaluated as text (no change)', LC, doc, 'x\nStatus: ﻿1\n', 'x\nStatus: ﻿1\n', []);
run('B5 a U+FEFF on a later line is evaluated as text', LC, doc, 'x\n﻿y\n', 'x\n﻿z\n', []);
run('B5 a U+FEFF inside a JSON string is evaluated as text', KO, cfg, '{"version":1,"x":"a﻿b"}', '{"version":2,"x":"a﻿b"}', []);
run('B5 a changed U+FEFF inside a JSON string holds as a changed key', KO, cfg, '{"x":"a﻿b"}', '{"x":"ab"}', [hold('rule-keys', 'tools/a/config.json', 'key-changed')]);
run('B5 a U+FEFF in the body is evaluated as text', FM, guide, base0, base0.replace('body', '﻿body'), []);
run('B5 a U+FEFF inside a front matter value is part of its block', FM, guide, base0, base0.replace('name: x', 'name: ﻿x'), [hold('rule-front-matter', 'docs/guides/a.md', 'front-matter-changed')]);

// Order of reasons for one entry: the types, then the rules of a type in array order.
test('reasons of one entry follow the order of the types, then the manifest order', () => {
  const rules = {
    front_matter_only: [{ glob: '**/*.md', keys: ['description'] }],
    keys_only: [{ glob: '**/*.md', keys: ['version'] }],
    hold_on_line_change: [{ glob: 'docs/**', pattern: 'Date:' }, { glob: 'docs/**', pattern: '^Status:' }],
    hold_on_add_delete: ['docs/**'],
  };
  const f = addedFile('docs/a.md');
  const reasons = evalOne(rules, f, undefined, '---\nStatus: x\nDate: y\n---\n');
  assert.deepEqual(reasons, [
    hold('rule-add-delete', 'docs/a.md', 'added'),
    hold('rule-line-change', 'docs/a.md', 'line-changed'),
    hold('rule-line-change', 'docs/a.md', 'line-changed'),
    hold('rule-keys', 'docs/a.md', 'added'),
    hold('rule-front-matter', 'docs/a.md', 'front-matter-changed'),
  ]);
});
test('entries are evaluated in the order given', () => {
  const files = [addedFile('docs/z.md'), deleted('docs/a.md'), addedFile('docs/m.md')];
  assert.deepEqual(evaluateContentRules(manifestWith(AD), files, {}).map((r) => r.detail), [
    'docs/z.md: added', 'docs/a.md: deleted', 'docs/m.md: added',
  ]);
});
test('no content_rules, or empty rule lists, give no reasons and need no contents', () => {
  const files = [addedFile('docs/a.md'), deleted('docs/b.md'), file('docs/c.md')];
  assert.deepEqual(evaluateContentRules(baselineManifest(), files, undefined), []);
  assert.deepEqual(evaluateContentRules(manifestWith({}), files, undefined), []);
  assert.deepEqual(evaluateContentRules(manifestWith({
    hold_on_add_delete: [], hold_on_line_change: [], keys_only: [], front_matter_only: [],
  }), files, undefined), []);
});

// X1: contentTargets.
test('X1 contentTargets lists matching A, M and D entries in diff order', () => {
  const m = manifestWith({ hold_on_line_change: [{ glob: 'docs/**', pattern: 'x' }] });
  const files = [addedFile('docs/a.md'), file('docs/b.md'), deleted('docs/c.md'), file('src/d.md')];
  assert.deepEqual(contentTargets(m, files), ['docs/a.md', 'docs/b.md', 'docs/c.md']);
});
test('X1 each of the types 2 to 4 names targets', () => {
  const files = [file('a/l.md'), file('b/k.json'), file('c/f.md')];
  const m = manifestWith({
    hold_on_line_change: [{ glob: 'a/**', pattern: 'x' }],
    keys_only: [{ glob: 'b/**', keys: ['k'] }],
    front_matter_only: [{ glob: 'c/**', keys: ['k'] }],
  });
  assert.deepEqual(contentTargets(m, files), ['a/l.md', 'b/k.json', 'c/f.md']);
});
test('X1 a path matched by two rules is listed once', () => {
  const m = manifestWith({ hold_on_line_change: [{ glob: 'docs/**', pattern: 'x' }], keys_only: [{ glob: '**/*.md', keys: ['k'] }] });
  assert.deepEqual(contentTargets(m, [file('docs/a.md')]), ['docs/a.md']);
});
test('X1 a type change is excluded, whatever its head mode', () => {
  const m = manifestWith({ hold_on_line_change: [{ glob: 'docs/**', pattern: 'x' }] });
  const files = [file('docs/a.md', { status: 'T' }), file('docs/b.md', { status: 'T', headMode: '120000', headHasNul: null }), file('docs/ok.md')];
  assert.deepEqual(contentTargets(m, files), ['docs/ok.md']);
});
test('X1 a head mode other than 100644 is excluded, for A and M', () => {
  const m = manifestWith({ keys_only: [{ glob: 'docs/**', keys: ['k'] }] });
  const files = [];
  for (const mode of ['100755', '120000', '160000']) {
    files.push(addedFile(`docs/a-${mode}.md`, { headMode: mode, headHasNul: null }));
    files.push(file(`docs/m-${mode}.md`, { headMode: mode, headHasNul: null }));
  }
  files.push(file('docs/ok.md'));
  assert.deepEqual(contentTargets(m, files), ['docs/ok.md']);
});
test('X1 a deleted entry is a target even when its base mode was not 100644', () => {
  const m = manifestWith({ keys_only: [{ glob: 'docs/**', keys: ['k'] }] });
  assert.deepEqual(contentTargets(m, [file('docs/a.md', { status: 'D', baseMode: '120000', headMode: null, headHasNul: null })]), ['docs/a.md']);
});
test('X1 a type 1 glob only, no rules and empty rules give no targets', () => {
  const files = [addedFile('docs/a.md'), file('docs/b.md')];
  assert.deepEqual(contentTargets(manifestWith(AD), files), []);
  assert.deepEqual(contentTargets(baselineManifest(), files), []);
  assert.deepEqual(contentTargets(manifestWith({}), files), []);
  assert.deepEqual(contentTargets(manifestWith({ keys_only: [], front_matter_only: [], hold_on_line_change: [] }), files), []);
});
test('X1 a glob matches in any case', () => {
  const m = manifestWith({ keys_only: [{ glob: 'Docs/**', keys: ['k'] }] });
  assert.deepEqual(contentTargets(m, [file('docs/A.json')]), ['docs/A.json']);
});

// X2: content-missing.
const all = { hold_on_line_change: [{ glob: 'docs/**', pattern: 'x' }] };
const missingRows = [
  ['contents absent altogether', file('docs/a.md'), undefined],
  ['a target missing from contents', file('docs/a.md'), {}],
  ['the base side absent for M', file('docs/a.md'), { 'docs/a.md': { base: absent, head: present('x') } }],
  ['the head side absent for M', file('docs/a.md'), { 'docs/a.md': { base: present('x'), head: absent } }],
  ['the head side absent for A', addedFile('docs/a.md'), { 'docs/a.md': { base: absent, head: absent } }],
  ['the base side present for A', addedFile('docs/a.md'), { 'docs/a.md': { base: present('x'), head: present('x') } }],
  ['the head side present for D', deleted('docs/a.md'), { 'docs/a.md': { base: present('x'), head: present('x') } }],
  ['the base side absent for D', deleted('docs/a.md'), { 'docs/a.md': { base: absent, head: absent } }],
  ['a side without a state', file('docs/a.md'), { 'docs/a.md': { base: {}, head: present('x') } }],
  ['a side that is not an object', file('docs/a.md'), { 'docs/a.md': { base: null, head: present('x') } }],
  ['an entry without sides', file('docs/a.md'), { 'docs/a.md': {} }],
  ['bytes missing for a blob under the cap', file('docs/a.md'), { 'docs/a.md': { base: { state: 'present', size: 3, bytes: null }, head: present('x') } }],
  ['a size that does not match the bytes', file('docs/a.md'), { 'docs/a.md': { base: { state: 'present', size: 9, bytes: enc('x') }, head: present('x') } }],
  ['bytes that are not a byte array', file('docs/a.md'), { 'docs/a.md': { base: { state: 'present', size: 1, bytes: 'x' }, head: present('x') } }],
  ['a size that is not a number', file('docs/a.md'), { 'docs/a.md': { base: { state: 'present', size: '1', bytes: enc('x') }, head: present('x') } }],
  ['an unknown status', file('docs/a.md', { status: 'X' }), { 'docs/a.md': { base: present('x'), head: present('x') } }],
];
for (const [name, f, contents] of missingRows) {
  test(`X2 ${name}`, () => {
    assert.deepEqual(evaluateContentRules(manifestWith(all), [f], contents), [missing(f.path)]);
  });
}
test('X2 a path that only exists on the prototype is missing', () => {
  for (const path of ['constructor', 'toString', '__proto__']) {
    const f = file(path);
    assert.deepEqual(evaluateContentRules(manifestWith({ hold_on_line_change: [{ glob: '**', pattern: 'x' }] }), [f], {}), [missing(path)]);
  }
});
test('X2 one content-missing reason per entry, however many rules match it', () => {
  const m = manifestWith({
    hold_on_line_change: [{ glob: 'docs/**', pattern: 'x' }, { glob: 'docs/**', pattern: 'y' }],
    keys_only: [{ glob: 'docs/**', keys: ['k'] }],
    front_matter_only: [{ glob: 'docs/**', keys: ['k'] }],
  });
  assert.deepEqual(evaluateContentRules(m, [file('docs/a.md')], {}), [missing('docs/a.md')]);
});
test('X2 type 1 reasons still appear beside content-missing, before it', () => {
  const m = manifestWith({ hold_on_add_delete: ['docs/**'], hold_on_line_change: [{ glob: 'docs/**', pattern: 'x' }] });
  assert.deepEqual(evaluateContentRules(m, [addedFile('docs/a.md')], {}), [hold('rule-add-delete', 'docs/a.md', 'added'), missing('docs/a.md')]);
});
test('X2 an entry that is not a target needs no contents', () => {
  const m = manifestWith({ hold_on_line_change: [{ glob: '**', pattern: 'x' }] });
  const files = [file('a', { status: 'T' }), addedFile('b', { headMode: '100755', headHasNul: null }), file('c', { headMode: '120000', headHasNul: null })];
  assert.deepEqual(evaluateContentRules(m, files, undefined), []);
});
test('X2 an entry outside every glob needs no contents', () => {
  assert.deepEqual(evaluateContentRules(manifestWith(all), [file('src/a.md')], undefined), []);
});
test('X2 a malformed side does not hide a reason of another entry', () => {
  const files = [file('docs/a.md'), file('docs/b.md')];
  const contents = { 'docs/b.md': { base: present('x\n'), head: present('') } };
  assert.deepEqual(evaluateContentRules(manifestWith(all), files, contents), [missing('docs/a.md'), hold('rule-line-change', 'docs/b.md', 'line-changed')]);
});

// X3: no reason carries file text, for any rule and any outcome.
test('X3 no reason contains the text of a file, a line, a key or a value', () => {
  const m = manifestWith({
    hold_on_add_delete: ['docs/**'],
    hold_on_line_change: [{ glob: 'docs/**', pattern: SENTINEL }],
    keys_only: [{ glob: 'docs/**/*.json', keys: ['version'] }],
    front_matter_only: [{ glob: 'docs/**/*.md', keys: ['description'] }],
  });
  const variants = [
    [file('docs/a.md'), `${SENTINEL}\n`, 'x\n'],
    [file('docs/b.json'), `{"${SENTINEL}":1}`, `{"${SENTINEL}":2}`],
    [file('docs/c.json'), `{"${SENTINEL}":1,"${SENTINEL}":2}`, `{"${SENTINEL}":2}`],
    [file('docs/d.md'), `---\n${SENTINEL}: 1\n---\n`, `---\n${SENTINEL}: 2\n---\n`],
    [file('docs/e.md'), `---\n${SENTINEL}: 1\n---\n`, `---\n"${SENTINEL}": 2\n---\n`],
    [addedFile('docs/f.md'), undefined, `---\n${SENTINEL}: 1\n---\n${SENTINEL}\n`],
    [deleted('docs/g.json'), `{"${SENTINEL}":1}`, undefined],
    [file('docs/h.md'), presentBytes([...enc(SENTINEL), 0xff]), 'x'],
  ];
  let seen = 0;
  for (const [f, base, head] of variants) {
    const reasons = evaluateContentRules(m, [f], sides(f, base, head));
    assert.ok(reasons.length > 0, f.path);
    assert.ok(!JSON.stringify(reasons).includes(SENTINEL), f.path);
    checkVocabulary(reasons, f);
    seen += reasons.length;
  }
  assert.ok(seen >= variants.length);
});

// Purity: neither the inputs nor repeated calls differ.
test('evaluateContentRules does not mutate its inputs and is deterministic', () => {
  const m = manifestWith({ keys_only: [{ glob: 'docs/**', keys: ['version'] }], hold_on_line_change: [{ glob: 'docs/**', pattern: 'x' }] });
  const files = [file('docs/a.json'), addedFile('docs/b.json')];
  const contents = { ...sides(files[0], '{"x":1}', '{"x":2}'), ...sides(files[1], undefined, '{"x":2}') };
  const copy = structuredClone({ m, files, contents });
  const first = evaluateContentRules(m, files, contents);
  const second = evaluateContentRules(m, files, contents);
  assert.deepEqual(first, second);
  assert.deepEqual({ m, files, contents }, copy);
});

// A near-cap number token must not cost quadratic time.
const fast = (name, fn) => test(name, { timeout: 20000 }, () => {
  const started = performance.now();
  fn();
  assert.ok(performance.now() - started < 2000, `took ${Math.round(performance.now() - started)} ms`);
});
fast('keys_only compares near-cap integers without rounding or quadratic work', () => {
  const digits = `1${'0'.repeat(CONTENT_MAX_BYTES - 60)}`;
  const base = `{"x":${digits}1}`;
  assert.deepEqual(evalOne(KO, cfg, base, base), []);
  assert.deepEqual(evalOne(KO, cfg, base, `{"x":${digits}2}`), [
    hold('rule-keys', 'tools/a/config.json', 'key-changed'),
  ]);
});

fast('keys_only normalizes near-cap fractions and exponents', () => {
  const fraction = `0.${'0'.repeat(CONTENT_MAX_BYTES - 80)}1`;
  const exponent = `1e${'9'.repeat(CONTENT_MAX_BYTES - 80)}`;
  assert.deepEqual(evalOne(KO, cfg, `{"x":${fraction}}`, `{"x":${fraction}e0}`), []);
  assert.deepEqual(evalOne(KO, cfg, `{"x":${exponent}}`, `{"x":${exponent}}`), []);
});

test('keys_only accepts 512 nested JSON containers and rejects 513', () => {
  const arrays = '['.repeat(510);
  const close = ']'.repeat(510);
  const atCap = `{"a":${arrays}{"b":"[{"}${close}}`;
  const beyondCap = `{"a":[${arrays}{"b":"[{"}${close}]}`;
  assert.deepEqual(evalOne(KO, cfg, atCap, atCap), []);
  assert.deepEqual(evalOne(KO, cfg, atCap, beyondCap), [
    hold('rule-keys', 'tools/a/config.json', 'unreadable'),
  ]);
});

const titleBase = 'Title\nStatus: draft\n';
run('hold_on_line_change rejects a lone CR hiding a guarded line in the head', LC, doc,
  titleBase, 'Title\rStatus: approved\nStatus: draft\n', [hold('rule-line-change', 'docs/s.md', 'unreadable')]);
run('hold_on_line_change rejects a Unicode line separator hiding a guarded line in the base', LC, doc,
  'Title\u2028Status: approved\nStatus: draft\n', titleBase, [hold('rule-line-change', 'docs/s.md', 'unreadable')]);
run('hold_on_line_change evaluates CRLF lines', LC, doc, 'Status: a\r\n', 'Status: b\r\n',
  [hold('rule-line-change', 'docs/s.md', 'line-changed')]);
run('keys_only reads a Unicode line separator inside a JSON string', KO, cfg,
  '{"x":"a"}', '{"x":"a\u2028b","version":2}', [hold('rule-keys', 'tools/a/config.json', 'key-changed')]);

run('front_matter_only rejects a blank line before the opener', FM, addedFile('docs/guides/a.md'),
  undefined, `\n${base0}`, [hold('rule-front-matter', 'docs/guides/a.md', 'front-matter-invalid')]);
run('front_matter_only permits a Markdown thematic break after text', FM, guide,
  'Introduction\n', 'Introduction\n\n---\n\nNext section\n', []);
run('front_matter_only rejects a line separator hiding a key inside a value', FM, guide,
  base0, base0.replace('description:', 'description: x\u2028tools: all '),
  [hold('rule-front-matter', 'docs/guides/a.md', 'front-matter-invalid')]);
run('front_matter_only permits line separators in the body', FM, guide, base0,
  base0.replace('body', 'a\u2028b\fc\rd'), []);
