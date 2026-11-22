import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validatePattern, matches } from '../../src/core/glob.js';

const matchRows = [
  { pattern: '**/claude*.md', path: 'CLAUDE.md', expected: true },
  { pattern: '**/claude*.md', path: 'docs/Claude.local.md', expected: true },
  { pattern: '**/claude*.md', path: 'a/b/claude.md', expected: true },
  { pattern: '**/claude*.md', path: 'claude.txt', expected: false },
  { pattern: '.github/**', path: '.github/a', expected: true },
  { pattern: '.github/**', path: '.github/a/b', expected: true },
  { pattern: '.github/**', path: 'x/.github/a', expected: false },
  { pattern: '**/.claude/**', path: '.claude/s.json', expected: true },
  { pattern: '**/.claude/**', path: 'a/.claude/s.json', expected: true },
  { pattern: '**/.claude/**', path: 'a/claude/s.json', expected: false },
  { pattern: 'src/*.go', path: 'src/a.go', expected: true },
  { pattern: 'src/*.go', path: 'src/a/b.go', expected: false },
  { pattern: 'src/**/*.go', path: 'src/b.go', expected: true },
  { pattern: 'src/**/*.go', path: 'src/a/b.go', expected: true },
  { pattern: 'src/**/*.go', path: 'src/a/b/c.go', expected: true },
  { pattern: 'src/**/*.go', path: 'lib/b.go', expected: false },
  { pattern: '**/package.json', path: 'package.json', expected: true },
  { pattern: '**/package.json', path: 'web/package.json', expected: true },
  { pattern: '**/package.json', path: 'web/package.json.bak', expected: false },
  { pattern: '**/requirements*.txt', path: 'requirements-dev.txt', expected: true },
  { pattern: 'readme.md', path: 'README.md', expected: true },
  { pattern: 'a.b', path: 'axb', expected: false },
  { pattern: 'a+b/(c)', path: 'a+b/(c)', expected: true },
  { pattern: '**/x', path: 'a\n/x', expected: true },
  { pattern: 'a/*', path: 'a/b\nc', expected: true },
  { pattern: '*', path: 'a/b', expected: false },
  { pattern: '**', path: 'a/b/c', expected: true },
];

for (const row of matchRows) {
  test(`matches ${row.pattern} against ${JSON.stringify(row.path)}`, () => {
    assert.equal(matches(row.pattern, row.path), row.expected);
  });
}

const invalidRows = [
  '', '/abs', 'a?b', 'a[b', 'a]b', 'a{b', 'a}b', 'a!b', 'a\\b', 'a//b', 'docs/',
];
for (const pattern of invalidRows) {
  test(`validatePattern rejects ${JSON.stringify(pattern)}`, () => {
    assert.equal(typeof validatePattern(pattern), 'string');
  });
}

for (const pattern of ['src/**', '**/claude*.md', '*.md', 'a/b.c', '.github/**', '**']) {
  test(`validatePattern accepts ${pattern}`, () => {
    assert.equal(validatePattern(pattern), null);
  });
}

test('validatePattern rejects a non-string', () => {
  assert.equal(typeof validatePattern(null), 'string');
  assert.equal(typeof validatePattern(5), 'string');
});

test('matches throws on an invalid pattern', () => {
  assert.throws(() => matches('a?b', 'a'));
});
