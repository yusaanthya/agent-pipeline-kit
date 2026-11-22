// Path patterns (design 5.4, "Pattern syntax"). Segments are separated by `/`.
// A segment `**` matches zero or more whole segments; `*` inside a segment
// matches any characters except `/`; every other character is literal.
// Matching is case-insensitive: both sides are lowercased.

const FORBIDDEN = /[?[\]{}!\\]/;

/** @returns {string|null} an error message, or null when the pattern is valid */
export function validatePattern(pattern) {
  if (typeof pattern !== 'string') return 'pattern must be a string';
  if (pattern === '') return 'pattern is empty';
  if (pattern.startsWith('/')) return `pattern starts with "/": ${pattern}`;
  if (FORBIDDEN.test(pattern)) return `pattern contains one of ? [ ] { } ! \\: ${pattern}`;
  if (pattern.split('/').includes('')) return `pattern has an empty segment: ${pattern}`;
  return null;
}

// Iterative wildcard match of one segment: linear backtracking, no regular
// expression, so a long pattern cannot make matching explode.
function matchSegment(pattern, text) {
  let p = 0;
  let t = 0;
  let star = -1;
  let mark = 0;
  while (t < text.length) {
    if (p < pattern.length && pattern[p] === '*') {
      star = p;
      p += 1;
      mark = t;
    } else if (p < pattern.length && pattern[p] === text[t]) {
      p += 1;
      t += 1;
    } else if (star !== -1) {
      p = star + 1;
      mark += 1;
      t = mark;
    } else {
      return false;
    }
  }
  while (p < pattern.length && pattern[p] === '*') p += 1;
  return p === pattern.length;
}

/** @returns {boolean} whether the pattern matches the path; the pattern must be valid */
export function matches(pattern, path) {
  const error = validatePattern(pattern);
  if (error !== null) throw new Error(error);
  const pat = pattern.toLowerCase().split('/');
  const segs = String(path).toLowerCase().split('/');
  const memo = new Map();
  const go = (pi, si) => {
    const key = pi * (segs.length + 1) + si;
    if (memo.has(key)) return memo.get(key);
    let result;
    if (pi === pat.length) {
      result = si === segs.length;
    } else if (pat[pi] === '**') {
      result = false;
      for (let k = si; k <= segs.length && !result; k += 1) result = go(pi + 1, k);
    } else {
      result = si < segs.length && matchSegment(pat[pi], segs[si]) && go(pi + 1, si + 1);
    }
    memo.set(key, result);
    return result;
  };
  return go(0, 0);
}
