// Pure parsers of `git diff -z` output (implementation plan section 1).
// Paths are bytes: they are decoded as UTF-8 and flagged when that is lossy.
// `key` is the raw path bytes as a latin1 string, so that the raw and numstat
// entries of one path can be joined without depending on decoding.

const RAW_META = /^:(\d{6}) (\d{6}) ([0-9a-f]{40}) ([0-9a-f]{40}) ([A-Z])$/;
const STATUSES = new Set(['A', 'M', 'D', 'T']);
const strict = new TextDecoder('utf-8', { fatal: true });

function decodePath(bytes) {
  try {
    return { path: strict.decode(bytes), pathBytesOk: true };
  } catch {
    return { path: bytes.toString('utf8'), pathBytesOk: false };
  }
}

// Splits at NUL; the output must end with a NUL.
function fields(buffer) {
  const out = [];
  let start = 0;
  while (start < buffer.length) {
    const end = buffer.indexOf(0, start);
    if (end === -1) throw new Error('git output is truncated: missing NUL terminator');
    out.push(buffer.subarray(start, end));
    start = end + 1;
  }
  return out;
}

const modeOrNull = (mode) => (mode === '000000' ? null : mode);

/**
 * @param {Buffer} buffer output of `git diff --raw -z --no-renames --no-abbrev`
 */
export function parseRawDiff(buffer) {
  const parts = fields(buffer);
  if (parts.length % 2 !== 0) throw new Error('git raw diff output is truncated: a path is missing');
  const entries = [];
  for (let i = 0; i < parts.length; i += 2) {
    const match = RAW_META.exec(parts[i].toString('latin1'));
    if (!match) throw new Error(`unexpected git raw diff record: ${parts[i].toString('latin1').slice(0, 80)}`);
    const [, srcMode, dstMode, srcSha, dstSha, status] = match;
    if (!STATUSES.has(status)) throw new Error(`unexpected git diff status: ${status}`);
    entries.push({
      ...decodePath(parts[i + 1]),
      status,
      baseMode: modeOrNull(srcMode),
      headMode: modeOrNull(dstMode),
      srcSha,
      dstSha,
      key: parts[i + 1].toString('latin1'),
    });
  }
  return entries;
}

/**
 * @param {Buffer} buffer output of `git diff --numstat -z --no-renames`
 */
export function parseNumstat(buffer) {
  return fields(buffer).map((record) => {
    const text = record.toString('latin1');
    const first = text.indexOf('\t');
    const second = first === -1 ? -1 : text.indexOf('\t', first + 1);
    if (second === -1) throw new Error(`unexpected git numstat record: ${text.slice(0, 80)}`);
    const added = text.slice(0, first);
    const deleted = text.slice(first + 1, second);
    const pathBytes = record.subarray(second + 1);
    const binary = added === '-' && deleted === '-';
    if (!binary && !(/^\d+$/.test(added) && /^\d+$/.test(deleted))) {
      throw new Error(`unexpected git numstat counts: ${added} ${deleted}`);
    }
    return {
      ...decodePath(pathBytes),
      added: binary ? null : Number(added),
      deleted: binary ? null : Number(deleted),
      key: pathBytes.toString('latin1'),
    };
  });
}
