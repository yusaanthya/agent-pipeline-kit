// Manifest, schema version 1. Any invalid manifest is
// `blocked:manifest`. Unknown keys are invalid at every level.
import { validatePattern } from './glob.js';
import { validateLinePattern } from './content.js';

const BRANCH = /^[A-Za-z0-9._/-]+$/;
const LANE_NAME = /^[a-z][a-z0-9-]*$/;
const MARKER_PREFIX = 'Auto-Merged-By: ';

const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

function branchError(value) {
  if (typeof value !== 'string' || !BRANCH.test(value) || value.startsWith('-') ||
      value.startsWith('/') || value.includes('..')) {
    return `invalid branch name: ${JSON.stringify(value)}`;
  }
  return null;
}

function checkKeys(obj, required, optional, where, errors) {
  for (const key of Object.keys(obj)) {
    if (!required.includes(key) && !optional.includes(key)) errors.push(`${where}: unknown key "${key}"`);
  }
  for (const key of required) {
    if (!Object.hasOwn(obj, key)) errors.push(`${where}: missing key "${key}"`);
  }
}

function checkPatterns(value, where, errors) {
  if (!Array.isArray(value)) {
    errors.push(`${where}: must be an array of patterns`);
    return;
  }
  for (const pattern of value) {
    const error = validatePattern(pattern);
    if (error !== null) errors.push(`${where}: ${error}`);
  }
}

// An array of `{glob, <field>}` entries; `field` is checked by `checkField`.
function checkRuleEntries(value, where, field, checkField, errors) {
  if (!Array.isArray(value)) {
    errors.push(`${where}: must be an array`);
    return;
  }
  value.forEach((entry, index) => {
    const at = `${where}[${index}]`;
    if (!isObject(entry)) {
      errors.push(`${at}: must be an object`);
      return;
    }
    checkKeys(entry, ['glob', field], [], at, errors);
    if (Object.hasOwn(entry, 'glob')) {
      const error = validatePattern(entry.glob);
      if (error !== null) errors.push(`${at}.glob: ${error}`);
    }
    if (Object.hasOwn(entry, field)) checkField(entry[field], `${at}.${field}`, errors);
  });
}

function checkLinePattern(value, where, errors) {
  const error = validateLinePattern(value);
  if (error !== null) errors.push(`${where}: ${error}`);
}

function checkKeyNames(value, where, errors) {
  const ok = Array.isArray(value) && value.length > 0 && value.every((k) => typeof k === 'string' && k !== '') &&
    new Set(value).size === value.length;
  if (!ok) errors.push(`${where}: must be a non-empty array of distinct non-empty strings`);
}

function checkHeadings(value, where, errors) {
  const ok = Array.isArray(value) && value.length > 0 && new Set(value).size === value.length &&
    value.every((h) => typeof h === 'string' && h.startsWith('## ') && !/[\r\n]/.test(h));
  if (!ok) errors.push(`${where}: must be a non-empty array of distinct heading lines, each starting with "## "`);
}

// Content rules. They only add holds.
function checkContentRules(rules, errors) {
  if (!isObject(rules)) {
    errors.push('content_rules: must be an object');
    return;
  }
  checkKeys(rules, [], ['hold_on_add_delete', 'hold_on_line_change', 'keys_only', 'front_matter_only', 'sections_only'], 'content_rules', errors);
  if (Object.hasOwn(rules, 'hold_on_add_delete')) checkPatterns(rules.hold_on_add_delete, 'content_rules.hold_on_add_delete', errors);
  if (Object.hasOwn(rules, 'hold_on_line_change')) {
    checkRuleEntries(rules.hold_on_line_change, 'content_rules.hold_on_line_change', 'pattern', checkLinePattern, errors);
  }
  if (Object.hasOwn(rules, 'keys_only')) checkRuleEntries(rules.keys_only, 'content_rules.keys_only', 'keys', checkKeyNames, errors);
  if (Object.hasOwn(rules, 'front_matter_only')) {
    checkRuleEntries(rules.front_matter_only, 'content_rules.front_matter_only', 'keys', checkKeyNames, errors);
  }
  if (Object.hasOwn(rules, 'sections_only')) {
    checkRuleEntries(rules.sections_only, 'content_rules.sections_only', 'sections', checkHeadings, errors);
  }
}

function checkLane(name, lane, errors) {
  const where = `lanes.${name}`;
  if (!isObject(lane)) {
    errors.push(`${where}: must be an object`);
    return;
  }
  checkKeys(lane, ['kind', 'base', 'auto_merge', 'tier', 'max_changed_lines', 'marker'], ['freeze_while_open', 'title_prefix', 'max_review_requests', 'max_fix_rounds'], where, errors);
  if (Object.hasOwn(lane, 'kind') && lane.kind !== 'queue' && lane.kind !== 'caller') {
    errors.push(`${where}.kind: must be "queue" or "caller"`);
  }
  if (Object.hasOwn(lane, 'base')) {
    const error = branchError(lane.base);
    if (error) errors.push(`${where}.base: ${error}`);
  }
  if (Object.hasOwn(lane, 'auto_merge') && typeof lane.auto_merge !== 'boolean') {
    errors.push(`${where}.auto_merge: must be a boolean`);
  }
  if (Object.hasOwn(lane, 'tier')) {
    const tier = lane.tier;
    if (!isObject(tier)) {
      errors.push(`${where}.tier: must be an object`);
    } else {
      checkKeys(tier, ['default', 'strong_review'], ['auto'], `${where}.tier`, errors);
      if (Object.hasOwn(tier, 'default') && tier.default !== 'auto' && tier.default !== 'hold') {
        errors.push(`${where}.tier.default: must be "auto" or "hold"`);
      }
      if (tier.default === 'hold' && !Object.hasOwn(tier, 'auto')) {
        errors.push(`${where}.tier.auto: required when default is "hold"`);
      }
      if (tier.default === 'auto' && Object.hasOwn(tier, 'auto')) {
        errors.push(`${where}.tier.auto: forbidden when default is "auto"`);
      }
      if (Object.hasOwn(tier, 'auto')) checkPatterns(tier.auto, `${where}.tier.auto`, errors);
      if (Object.hasOwn(tier, 'strong_review')) checkPatterns(tier.strong_review, `${where}.tier.strong_review`, errors);
    }
  }
  if (Object.hasOwn(lane, 'max_changed_lines')) {
    const n = lane.max_changed_lines;
    if (n !== null && !(Number.isSafeInteger(n) && n > 0)) {
      errors.push(`${where}.max_changed_lines: must be a positive integer or null`);
    }
  }
  if (Object.hasOwn(lane, 'max_review_requests')) {
    const n = lane.max_review_requests;
    if (n !== null && !(Number.isSafeInteger(n) && n > 0)) {
      errors.push(`${where}.max_review_requests: must be a positive integer or null`);
    }
  }
  if (Object.hasOwn(lane, 'max_fix_rounds')) {
    const n = lane.max_fix_rounds;
    if (n !== null && !(Number.isSafeInteger(n) && n > 0)) {
      errors.push(`${where}.max_fix_rounds: must be a positive integer or null`);
    }
  }
  if (Object.hasOwn(lane, 'freeze_while_open')) {
    const freeze = lane.freeze_while_open;
    if (!isObject(freeze)) {
      errors.push(`${where}.freeze_while_open: must be an object`);
    } else {
      checkKeys(freeze, ['head', 'base'], [], `${where}.freeze_while_open`, errors);
      for (const key of ['head', 'base']) {
        if (Object.hasOwn(freeze, key)) {
          const error = branchError(freeze[key]);
          if (error) errors.push(`${where}.freeze_while_open.${key}: ${error}`);
        }
      }
    }
  }
  if (Object.hasOwn(lane, 'title_prefix')) {
    const prefix = lane.title_prefix;
    if (lane.kind !== 'caller') errors.push(`${where}.title_prefix: allowed only on a caller lane`);
    if (typeof prefix !== 'string' || prefix === '' || /[\r\n]/.test(prefix)) {
      errors.push(`${where}.title_prefix: must be a non-empty one-line string`);
    }
  }
  if (Object.hasOwn(lane, 'marker')) {
    const marker = lane.marker;
    if (typeof marker !== 'string' || !marker.startsWith(MARKER_PREFIX) || /[\r\n]/.test(marker) ||
        marker.slice(MARKER_PREFIX.length).trim() === '') {
      errors.push(`${where}.marker: must be one line starting with "${MARKER_PREFIX}" followed by text`);
    }
  }
}

/**
 * @param {string|null} text
 * @returns {{ok: true, manifest: object} | {ok: false, code: 'manifest-missing'|'manifest-json'|'manifest-invalid', errors: string[]}}
 */
export function parseManifest(text) {
  if (text === null || text === undefined) {
    return { ok: false, code: 'manifest-missing', errors: ['the manifest file does not exist'] };
  }
  let manifest;
  try {
    manifest = JSON.parse(text);
  } catch (error) {
    return { ok: false, code: 'manifest-json', errors: [`not valid JSON: ${error.message}`] };
  }
  const errors = [];
  if (!isObject(manifest)) {
    return { ok: false, code: 'manifest-invalid', errors: ['the manifest must be a JSON object'] };
  }
  checkKeys(manifest, ['schema', 'kit', 'checks', 'codex_clean', 'hold_paths', 'lanes'], ['content_rules'], 'manifest', errors);
  if (Object.hasOwn(manifest, 'schema') && manifest.schema !== 1) errors.push('schema: must be 1');
  if (Object.hasOwn(manifest, 'kit') && !(typeof manifest.kit === 'string' && /^[0-9a-f]{40}$/.test(manifest.kit))) {
    errors.push('kit: must be 40 lowercase hex characters');
  }
  if (Object.hasOwn(manifest, 'checks')) {
    const checks = manifest.checks;
    const ok = checks === 'none' ||
      (Array.isArray(checks) && checks.length > 0 && checks.every((c) => typeof c === 'string' && c !== ''));
    if (!ok) errors.push('checks: must be "none" or a non-empty array of check names');
  }
  if (Object.hasOwn(manifest, 'codex_clean') && manifest.codex_clean !== 'no_blocking' && manifest.codex_clean !== 'no_findings') {
    errors.push('codex_clean: must be "no_blocking" or "no_findings"');
  }
  if (Object.hasOwn(manifest, 'hold_paths')) checkPatterns(manifest.hold_paths, 'hold_paths', errors);
  if (Object.hasOwn(manifest, 'content_rules')) checkContentRules(manifest.content_rules, errors);
  if (Object.hasOwn(manifest, 'lanes')) {
    const lanes = manifest.lanes;
    if (!isObject(lanes) || Object.keys(lanes).length === 0) {
      errors.push('lanes: must be an object with at least one lane');
    } else {
      let queueLanes = 0;
      for (const [name, lane] of Object.entries(lanes)) {
        if (!LANE_NAME.test(name)) errors.push(`lanes: invalid lane name ${JSON.stringify(name)}`);
        if (isObject(lane) && lane.kind === 'queue') queueLanes += 1;
        checkLane(name, lane, errors);
      }
      if (queueLanes > 1) errors.push('lanes: at most one lane may have kind "queue"');
      // At most one lane can match a title: no prefix may start with another.
      const prefixed = Object.entries(lanes)
        .filter(([, lane]) => isObject(lane) && typeof lane.title_prefix === 'string' && lane.title_prefix !== '');
      for (let i = 0; i < prefixed.length; i += 1) {
        for (let j = i + 1; j < prefixed.length; j += 1) {
          const [a, b] = [prefixed[i], prefixed[j]];
          if (a[1].title_prefix.startsWith(b[1].title_prefix) || b[1].title_prefix.startsWith(a[1].title_prefix)) {
            errors.push(`lanes: title_prefix of "${a[0]}" and "${b[0]}" overlap`);
          }
        }
      }
    }
  }
  if (errors.length > 0) return { ok: false, code: 'manifest-invalid', errors };
  return { ok: true, manifest };
}
