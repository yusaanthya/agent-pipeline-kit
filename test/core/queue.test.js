import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readMergeField } from '../../src/core/queue.js';

const rows = [
  { name: 'merge runner', text: '---\nid: sim-1\nmerge: runner\n---\n', expected: { ok: true, value: 'runner' } },
  { name: 'merge owner', text: '---\nmerge: owner\n---\nbody', expected: { ok: true, value: 'owner' } },
  { name: 'extra spaces and tabs', text: '---\nmerge:\t owner \t\n---\n', expected: { ok: true, value: 'owner' } },
  { name: 'no merge line', text: '---\nid: sim-1\n---\n', expected: { ok: true, value: null } },
  { name: 'empty front matter', text: '---\n---\n', expected: { ok: true, value: null } },
  { name: 'a merge line in the body is ignored', text: '---\nid: x\n---\nmerge: owner\n', expected: { ok: true, value: null } },
  { name: 'indented merge line is not a key', text: '---\n  merge: owner\n---\n', expected: { ok: true, value: null } },
  { name: 'unknown value', text: '---\nmerge: maybe\n---\n', expected: { ok: false } },
  { name: 'quoted value', text: '---\nmerge: "owner"\n---\n', expected: { ok: false } },
  { name: 'value with two words', text: '---\nmerge: runner now\n---\n', expected: { ok: false } },
  { name: 'empty value', text: '---\nmerge:\n---\n', expected: { ok: false } },
  { name: 'CRLF front matter', text: '---\r\nmerge: runner\r\n---\r\n', expected: { ok: false } },
  { name: 'CR inside the front matter', text: '---\nid: x\rmerge: runner\n---\n', expected: { ok: false } },
  { name: 'two merge lines', text: '---\nmerge: runner\nmerge: runner\n---\n', expected: { ok: false } },
  { name: 'no closing line', text: '---\nmerge: runner\n', expected: { ok: false } },
  { name: 'no front matter', text: 'merge: runner\n', expected: { ok: false } },
  { name: 'opener with trailing space', text: '--- \nmerge: runner\n---\n', expected: { ok: false } },
  { name: 'byte order mark before the opener', text: '﻿---\nmerge: runner\n---\n', expected: { ok: false } },
  { name: 'empty text', text: '', expected: { ok: false } },
];

for (const row of rows) {
  test(`readMergeField: ${row.name}`, () => {
    assert.deepEqual(readMergeField(row.text), row.expected);
  });
}
