import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRawDiff, parseNumstat } from '../../src/collect/parse.js';

const S1 = '1'.repeat(40);
const S2 = '2'.repeat(40);
const Z = '0'.repeat(40);
const meta = (a, b, x, y, st) => `:${a} ${b} ${x} ${y} ${st}`;
const raw = (...entries) => Buffer.concat(entries.map(([m, path]) => Buffer.concat([Buffer.from(`${m}\0`), Buffer.isBuffer(path) ? path : Buffer.from(path), Buffer.from('\0')])));

test('parse 1: raw -z output with A, M, D and T entries and modes', () => {
  const out = parseRawDiff(raw(
    [meta('100644', '100755', S1, S1, 'M'), 'a.txt'],
    [meta('100644', '000000', S1, Z, 'D'), 'b.sh'],
    [meta('000000', '100644', Z, S2, 'A'), 'c/d.txt'],
    [meta('120000', '100644', S1, S2, 'T'), 'link'],
  ));
  assert.deepEqual(out.map(({ key, ...rest }) => rest), [
    { path: 'a.txt', pathBytesOk: true, status: 'M', baseMode: '100644', headMode: '100755', srcSha: S1, dstSha: S1 },
    { path: 'b.sh', pathBytesOk: true, status: 'D', baseMode: '100644', headMode: null, srcSha: S1, dstSha: Z },
    { path: 'c/d.txt', pathBytesOk: true, status: 'A', baseMode: null, headMode: '100644', srcSha: Z, dstSha: S2 },
    { path: 'link', pathBytesOk: true, status: 'T', baseMode: '120000', headMode: '100644', srcSha: S1, dstSha: S2 },
  ]);
});

test('parse 2: a path with non-ASCII UTF-8 bytes and a path with a newline', () => {
  const out = parseRawDiff(raw(
    [meta('000000', '100644', Z, S2, 'A'), 'café/測試.md'],
    [meta('000000', '100644', Z, S2, 'A'), 'a\nb.txt'],
  ));
  assert.equal(out[0].path, 'café/測試.md');
  assert.equal(out[0].pathBytesOk, true);
  assert.equal(out[1].path, 'a\nb.txt');
});

test('parse 3: numstat -\\t-\\t is a binary entry', () => {
  const out = parseNumstat(Buffer.from('3\t1\ta.txt\0-\t-\tbin.dat\0'));
  assert.deepEqual(out.map(({ key, ...rest }) => rest), [
    { path: 'a.txt', pathBytesOk: true, added: 3, deleted: 1 },
    { path: 'bin.dat', pathBytesOk: true, added: null, deleted: null },
  ]);
});

test('parse 3b: numstat paths with a tab or a newline', () => {
  const out = parseNumstat(Buffer.from('1\t2\ta\tb.txt\0'));
  assert.equal(out[0].path, 'a\tb.txt');
  assert.equal(parseNumstat(Buffer.from('1\t2\ta\nb.txt\0'))[0].path, 'a\nb.txt');
});

test('parse 4: an unknown status letter throws', () => {
  for (const st of ['R', 'C', 'U', 'X', 'B', 'Z']) {
    assert.throws(() => parseRawDiff(raw([meta('100644', '100644', S1, S2, st), 'a.txt'])), /status/);
  }
});

test('parse 5: invalid UTF-8 bytes give pathBytesOk false', () => {
  const out = parseRawDiff(raw([meta('000000', '100644', Z, S2, 'A'), Buffer.from([0x61, 0xff, 0x62])]));
  assert.equal(out[0].pathBytesOk, false);
  assert.equal(out[0].path, 'a�b');
});

test('the raw key and the numstat key of one path are equal', () => {
  const bytes = Buffer.from([0x61, 0xff, 0x62]);
  const r = parseRawDiff(raw([meta('000000', '100644', Z, S2, 'A'), bytes]));
  const n = parseNumstat(Buffer.concat([Buffer.from('1\t0\t'), bytes, Buffer.from('\0')]));
  assert.equal(r[0].key, n[0].key);
});

test('empty output parses to an empty list', () => {
  assert.deepEqual(parseRawDiff(Buffer.alloc(0)), []);
  assert.deepEqual(parseNumstat(Buffer.alloc(0)), []);
});

test('malformed raw output throws', () => {
  assert.throws(() => parseRawDiff(Buffer.from('garbage\0a.txt\0')));
  assert.throws(() => parseRawDiff(Buffer.from(`${meta('100644', '100644', S1, S2, 'M')}\0`)), /truncated/);
  assert.throws(() => parseRawDiff(raw([`:10064 100644 ${S1} ${S2} M`, 'a.txt'])));
  assert.throws(() => parseRawDiff(Buffer.from(`${meta('100644', '100644', S1, S2, 'M')}\0a.txt`)), /truncated/);
});

test('malformed numstat output throws', () => {
  assert.throws(() => parseNumstat(Buffer.from('x\ty\ta.txt\0')));
  assert.throws(() => parseNumstat(Buffer.from('1\t2\0')));
  assert.throws(() => parseNumstat(Buffer.from('1\t2\ta.txt')), /truncated/);
});
