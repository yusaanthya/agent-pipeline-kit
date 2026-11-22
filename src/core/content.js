// Content rules (design 5.4.1, implementation plan section 9). Pure: no I/O,
// no clock, no randomness. A content rule can only add a hold, and no reason
// it returns carries text from a file.
import { CONTENT_MAX_BYTES } from './constants.js';
import { matches } from './glob.js';

/**
 * Lines of a text: split at "\n", one trailing "\r" removed from each line, a
 * final line without a newline counts, an empty text has no lines.
 * @param {string} text
 * @returns {string[]}
 */
export function splitLines(text) {
  if (text === '') return [];
  const parts = text.split('\n');
  if (parts[parts.length - 1] === '') parts.pop();
  return parts.map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line));
}

// A line pattern is a non-empty literal with an optional leading "^" and an
// optional trailing "$" (design 5.4.1, type 2). Nothing else is special.
function readLinePattern(pattern) {
  if (typeof pattern !== 'string') return null;
  let literal = pattern;
  const start = literal.startsWith('^');
  if (start) literal = literal.slice(1);
  const end = literal.endsWith('$');
  if (end) literal = literal.slice(0, -1);
  // A line never contains "\n", so a pattern with one could never match.
  if (literal === '' || literal.includes('\n')) return null;
  return { literal, start, end };
}

/** @returns {string|null} an error message, or null when the line pattern is valid */
export function validateLinePattern(pattern) {
  return readLinePattern(pattern) === null
    ? 'line pattern must be a non-empty literal with an optional leading ^ and trailing $, and no newline'
    : null;
}

/** @returns {boolean} whether the line matches the pattern; the pattern must be valid */
export function matchLine(pattern, line) {
  const parsed = readLinePattern(pattern);
  if (parsed === null) throw new Error('invalid line pattern');
  const { literal, start, end } = parsed;
  if (start && end) return line === literal;
  if (start) return line.startsWith(literal);
  if (end) return line.endsWith(literal);
  return line.includes(literal);
}

function countMatching(pattern, text) {
  const counts = new Map();
  if (text === null) return counts;
  for (const line of splitLines(text)) {
    if (matchLine(pattern, line)) counts.set(line, (counts.get(line) ?? 0) + 1);
  }
  return counts;
}

/**
 * Whether a line text that matches the pattern occurs a different number of
 * times on the two sides. Order is not compared. A null side has no lines.
 * @param {string} pattern
 * @param {string|null} baseText
 * @param {string|null} headText
 * @returns {boolean}
 */
export function changedLines(pattern, baseText, headText) {
  const base = countMatching(pattern, baseText);
  const head = countMatching(pattern, headText);
  for (const [line, n] of base) if ((head.get(line) ?? 0) !== n) return true;
  for (const [line, n] of head) if ((base.get(line) ?? 0) !== n) return true;
  return false;
}

// A number whose exact decimal value differs from its double. JSON.parse
// would give two different huge or long numbers the same double, so such a
// number is kept as its canonical decimal text and compared by that.
class LossyNumber {
  constructor(canonical) {
    this.canonical = canonical;
  }
}

const NUMBER = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/;

// The exact value of a JSON number token as `<digits>e<point>`: the value is
// 0.<digits> * 10^point, with no leading or trailing zero in the digits. Zero,
// whatever its sign, is "0".
function canonicalNumber(token) {
  const match = NUMBER.exec(token);
  if (match === null) throw new Error('not a JSON number');
  const [, sign, int, frac = '', exp = '0'] = match;
  let digits = int + frac;
  let point = BigInt(int.length) + BigInt(exp);
  const lead = digits.length - digits.replace(/^0+/, '').length;
  digits = digits.slice(lead).replace(/0+$/, '');
  point -= BigInt(lead);
  if (digits === '') return '0';
  return `${sign}${digits}e${point}`;
}

function reviveNumber(key, value, context) {
  if (typeof value !== 'number') return value;
  // Without the source text the exact value is unknown: refuse to parse.
  if (typeof context?.source !== 'string') throw new Error('JSON source text is unavailable');
  // The common case: the token is what the double prints as.
  if (context.source === String(value)) return value;
  const exact = canonicalNumber(context.source);
  if (!Number.isFinite(value)) return new LossyNumber(exact);
  return exact === canonicalNumber(String(value)) ? value : new LossyNumber(exact);
}

// Whether any object of a text that is already valid JSON has a key twice.
// Keys are compared decoded, so "a" and "a" are the same key.
function hasDuplicateKey(text) {
  const stack = []; // a Set of keys for an object, null for an array
  let expectKey = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      if (expectKey) {
        const key = JSON.parse(text.slice(i, j + 1));
        const keys = stack[stack.length - 1];
        if (keys.has(key)) return true;
        keys.add(key);
        expectKey = false;
      }
      i = j;
    } else if (c === '{') {
      stack.push(new Set());
      expectKey = true;
    } else if (c === '[') {
      stack.push(null);
      expectKey = false;
    } else if (c === '}' || c === ']') {
      stack.pop();
      expectKey = false;
    } else if (c === ',') {
      expectKey = stack.length > 0 && stack[stack.length - 1] !== null;
    }
  }
  return false;
}

/**
 * JSON whose top level is an object, without a byte-order mark and without a
 * duplicate key at any depth. A tokenizer finds the duplicate keys; JSON.parse
 * parses the values.
 * @param {string} text
 * @returns {{ok: true, value: object} | {ok: false}}
 */
export function parseStrictJson(text) {
  if (typeof text !== 'string' || text.charCodeAt(0) === 0xFEFF) return { ok: false };
  let value;
  try {
    value = JSON.parse(text, reviveNumber);
  } catch {
    return { ok: false };
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value) || value instanceof LossyNumber) return { ok: false };
  if (hasDuplicateKey(text)) return { ok: false };
  return { ok: true, value };
}

// Whether two parsed JSON values are the same JSON value: objects without key
// order, arrays with order, numbers by exact numeric value. Iterative, so a
// deeply nested file cannot overflow the stack.
function sameValue(a, b) {
  const pairs = [[a, b]];
  while (pairs.length > 0) {
    const [x, y] = pairs.pop();
    if (x === y) continue;
    if (typeof x !== 'object' || typeof y !== 'object' || x === null || y === null) return false;
    if (x instanceof LossyNumber || y instanceof LossyNumber) {
      if (!(x instanceof LossyNumber && y instanceof LossyNumber && x.canonical === y.canonical)) return false;
      continue;
    }
    if (Array.isArray(x) !== Array.isArray(y)) return false;
    if (Array.isArray(x)) {
      if (x.length !== y.length) return false;
      for (let i = 0; i < x.length; i += 1) pairs.push([x[i], y[i]]);
    } else {
      const keys = Object.keys(x);
      if (keys.length !== Object.keys(y).length) return false;
      for (const key of keys) {
        if (!Object.hasOwn(y, key)) return false;
        pairs.push([x[key], y[key]]);
      }
    }
  }
  return true;
}

const KEY_LINE = /^[A-Za-z0-9_][A-Za-z0-9_-]*:/;

/**
 * The front matter of a Markdown text (design 5.4.1, type 4): the map from
 * each key to its block text. A text whose first line does not start with
 * `---` has none (an empty map); null is an absent side.
 * @param {string|null} text
 * @returns {{ok: true, blocks: Map<string, string>} | {ok: false}}
 */
export function readFrontMatter(text) {
  const blocks = new Map();
  if (text === null || !text.startsWith('---')) return { ok: true, blocks };
  // Raw lines: the carriage-return rule is checked before any CR is removed.
  const lines = text.split('\n');
  if (lines[0] !== '---') return { ok: false };
  const close = lines.indexOf('---', 1);
  if (close === -1) return { ok: false };
  let key = null;
  let block = [];
  const flush = () => {
    if (key !== null) blocks.set(key, block.join('\n'));
  };
  for (let i = 1; i < close; i += 1) {
    const line = lines[i];
    if (line.includes('\r')) return { ok: false };
    if (KEY_LINE.test(line)) {
      flush();
      key = line.slice(0, line.indexOf(':'));
      if (blocks.has(key)) return { ok: false };
      block = [line];
    } else if (line === '' || (key !== null && (line.startsWith(' ') || line.startsWith('\t') || line.startsWith('- ')))) {
      if (key !== null) block.push(line);
    } else {
      return { ok: false };
    }
  }
  flush();
  return { ok: true, blocks };
}

// An entry is a content target unless the mode condition already holds it: a
// type change, or a head mode that exists and is not 100644. A deleted entry
// has no head mode and is a target.
const isTarget = (f) => f.status !== 'T' && (f.headMode === null || f.headMode === '100644');

const hold = (f, code, word) => ({ verdict: 'hold:owner', code, detail: `${f.path}: ${word}` });
const missing = (f) => ({ verdict: 'blocked:input', code: 'content-missing', detail: f.path });

// Which sides a status says exist: [base, head]; null for an unknown status.
const EXISTS = { A: [false, true], M: [true, true], D: [true, false] };

const isObject = (v) => typeof v === 'object' && v !== null;

// One side as the core reads it: {kind: 'absent'} | {kind: 'unreadable'} |
// {kind: 'text', text}. Null when the collector's answer is malformed or
// contradicts the status (a collector fault, not a property of the change).
function readSide(side, shouldExist) {
  if (!isObject(side)) return null;
  if (side.state === 'absent') return shouldExist ? null : { kind: 'absent' };
  if (side.state !== 'present' || !shouldExist) return null;
  const { size, bytes } = side;
  if (!Number.isSafeInteger(size) || size < 0) return null;
  if (bytes === null) return size > CONTENT_MAX_BYTES ? { kind: 'unreadable' } : null;
  if (!(bytes instanceof Uint8Array) || bytes.length !== size) return null;
  if (size > CONTENT_MAX_BYTES || bytes.includes(0)) return { kind: 'unreadable' };
  let text;
  try {
    // ignoreBOM keeps a leading U+FEFF in the text, so that it can be seen.
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return { kind: 'unreadable' };
  }
  return text.charCodeAt(0) === 0xFEFF ? { kind: 'unreadable' } : { kind: 'text', text };
}

function readSides(f, contents) {
  const exists = EXISTS[f.status];
  if (exists === undefined || !isObject(contents) || !Object.hasOwn(contents, f.path)) return null;
  const entry = contents[f.path];
  if (!isObject(entry)) return null;
  const base = readSide(entry.base, exists[0]);
  const head = readSide(entry.head, exists[1]);
  return base === null || head === null ? null : { base, head };
}

const textOf = (side) => (side.kind === 'text' ? side.text : null);
const anyUnreadable = (sides) => sides.base.kind === 'unreadable' || sides.head.kind === 'unreadable';

// Type 3 on a modified entry: every top-level key that is not named must be
// present on both sides with the same value.
function keysChanged(base, head, named) {
  const names = new Set([...Object.keys(base), ...Object.keys(head)]);
  for (const key of names) {
    if (named.includes(key)) continue;
    if (!Object.hasOwn(base, key) || !Object.hasOwn(head, key) || !sameValue(base[key], head[key])) return true;
  }
  return false;
}

// Type 4: every front-matter key that is not named must be present on both
// sides with identical block text.
function blocksChanged(base, head, named) {
  const names = new Set([...base.keys(), ...head.keys()]);
  for (const key of names) {
    if (named.includes(key)) continue;
    if (!base.has(key) || !head.has(key) || base.get(key) !== head.get(key)) return true;
  }
  return false;
}

function entryReasons(rules, f, contents) {
  const reasons = [];
  if (!isTarget(f)) return reasons;
  const hits = (list) => (list ?? []).filter((rule) => matches(rule.glob, f.path));

  // Type 1 reads no contents.
  if (f.status === 'A' || f.status === 'D') {
    for (const glob of (rules.hold_on_add_delete ?? [])) {
      if (matches(glob, f.path)) reasons.push(hold(f, 'rule-add-delete', f.status === 'A' ? 'added' : 'deleted'));
    }
  }

  const lineRules = hits(rules.hold_on_line_change);
  const keyRules = hits(rules.keys_only);
  const frontRules = hits(rules.front_matter_only);
  if (lineRules.length + keyRules.length + frontRules.length === 0) return reasons;
  const sides = readSides(f, contents);
  if (sides === null) {
    reasons.push(missing(f));
    return reasons;
  }
  const unreadable = anyUnreadable(sides);

  for (const rule of lineRules) {
    if (unreadable) reasons.push(hold(f, 'rule-line-change', 'unreadable'));
    else if (changedLines(rule.pattern, textOf(sides.base), textOf(sides.head))) reasons.push(hold(f, 'rule-line-change', 'line-changed'));
  }

  let parsed = null; // [base, head], parsed once for every keys_only rule
  for (const rule of keyRules) {
    // The status comes first: an added or deleted structured file holds
    // whatever its content, so its existing side is never parsed.
    if (f.status === 'A') { reasons.push(hold(f, 'rule-keys', 'added')); continue; }
    if (f.status === 'D') { reasons.push(hold(f, 'rule-keys', 'deleted')); continue; }
    if (!unreadable && parsed === null) parsed = [parseStrictJson(sides.base.text), parseStrictJson(sides.head.text)];
    if (unreadable || !parsed[0].ok || !parsed[1].ok) reasons.push(hold(f, 'rule-keys', 'unreadable'));
    else if (keysChanged(parsed[0].value, parsed[1].value, rule.keys)) reasons.push(hold(f, 'rule-keys', 'key-changed'));
  }

  let fronts = null;
  for (const rule of frontRules) {
    if (unreadable) { reasons.push(hold(f, 'rule-front-matter', 'unreadable')); continue; }
    if (fronts === null) fronts = [readFrontMatter(textOf(sides.base)), readFrontMatter(textOf(sides.head))];
    if (!fronts[0].ok || !fronts[1].ok) reasons.push(hold(f, 'rule-front-matter', 'front-matter-invalid'));
    else if (blocksChanged(fronts[0].blocks, fronts[1].blocks, rule.keys)) reasons.push(hold(f, 'rule-front-matter', 'front-matter-changed'));
  }
  return reasons;
}

/**
 * The hold reasons of the manifest's content rules for the changed entries, in
 * the order of `files`; a reason names a path and one word, never file text.
 * A target whose blobs the collector did not supply, or supplied against the
 * status, gives `blocked:input` (`content-missing`).
 * @param {object} manifest a validated manifest
 * @param {object[]} files FileChange entries
 * @param {Record<string, {base: object, head: object}>|undefined} contents
 * @returns {{verdict: string, code: string, detail: string}[]}
 */
export function evaluateContentRules(manifest, files, contents) {
  const rules = manifest.content_rules ?? {};
  return files.flatMap((f) => entryReasons(rules, f, contents));
}

/**
 * The paths whose blobs the collector must read: entries that match a glob of
 * `hold_on_line_change`, `keys_only` or `front_matter_only` and are content
 * targets. In diff order, each path once.
 * @param {object} manifest a validated manifest
 * @param {object[]} files FileChange entries
 * @returns {string[]}
 */
export function contentTargets(manifest, files) {
  const rules = manifest.content_rules ?? {};
  const globs = [...(rules.hold_on_line_change ?? []), ...(rules.keys_only ?? []), ...(rules.front_matter_only ?? [])].map((rule) => rule.glob);
  const paths = [];
  for (const f of files) {
    if (isTarget(f) && globs.some((glob) => matches(glob, f.path)) && !paths.includes(f.path)) paths.push(f.path);
  }
  return paths;
}
