// GitHub REST reads through `gh api` (design 4). REST
// only: GraphQL is not used. No decisions here.

const MAX_PAGES = 100;
const PER_PAGE = 100;

/** @param {typeof import('./proc.js').run} run */
export function makeGithub(run) {
  async function get(path) {
    if (!/^\/repos\/[\x21-\x7e]+$/.test(path)) throw new Error(`refusing an unexpected API path: ${path}`);
    const result = await run('gh', ['api', '--method', 'GET', '-H', 'Accept: application/vnd.github+json', path], {
      timeoutMs: 60_000,
    });
    if (result.code !== 0) {
      const detail = result.stderr.toString('utf8').trim().slice(0, 300);
      throw new Error(`gh api ${path} failed (exit ${result.code}): ${detail}`);
    }
    try {
      return JSON.parse(result.stdout.toString('utf8'));
    } catch (error) {
      throw new Error(`gh api ${path} returned invalid JSON: ${error.message}`);
    }
  }

  // Reads every page: until a page has fewer than 100 items. More than 100
  // pages throws. `key` names the array inside an object response.
  async function paginate(path, key = null) {
    const items = [];
    const sep = path.includes('?') ? '&' : '?';
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const body = await get(`${path}${sep}per_page=${PER_PAGE}&page=${page}`);
      const list = key === null ? body : body?.[key];
      if (!Array.isArray(list)) throw new Error(`gh api ${path}: expected an array${key ? ` under "${key}"` : ''}`);
      items.push(...list);
      if (list.length < PER_PAGE) return items;
    }
    throw new Error(`gh api ${path}: more than ${MAX_PAGES} pages`);
  }

  return { get, paginate };
}
