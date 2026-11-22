// Front matter of a queue item (design 5.3, plan 3.2): read one key, `merge`.

/**
 * @param {string} text
 * @returns {{ok: true, value: 'runner'|'owner'|null} | {ok: false}}
 */
export function readMergeField(text) {
  if (typeof text !== 'string') return { ok: false };
  const lines = text.split('\n');
  if (lines[0] !== '---') return { ok: false };
  const end = lines.indexOf('---', 1);
  if (end === -1) return { ok: false };
  const front = lines.slice(1, end);
  if (front.some((line) => line.includes('\r'))) return { ok: false };
  const mergeLines = front.filter((line) => line.startsWith('merge:'));
  if (mergeLines.length === 0) return { ok: true, value: null };
  if (mergeLines.length > 1) return { ok: false };
  const match = /^merge:[ \t]*(\S+)[ \t]*$/.exec(mergeLines[0]);
  if (!match) return { ok: false };
  if (match[1] === 'runner' || match[1] === 'owner') return { ok: true, value: match[1] };
  return { ok: false };
}
