// Constants of the gate (design sections 3.1, 5.2, 5.4, 5.5, 5.8).

// The trusted Codex bot. Both values must match for an item to be trusted.
// Copied from scripts/codex-review-gate.mjs in quorum-election-simulator.
export const CODEX_BOT = Object.freeze({ id: 199175422, login: 'chatgpt-codex-connector[bot]' });

// app.slug of check runs created by GitHub Actions.
export const ACTIONS_APP_SLUG = 'github-actions';

// Paths whose change always needs the owner (design 5.4). Lowercase.
export const FLOOR = Object.freeze([
  // CI and pipeline
  '.github/**',
  '.agent-line/**',
  // Agent configuration
  '**/.claude/**',
  '**/.codex/**',
  '**/.agents/**',
  '**/claude*.md',
  '**/agents*.md',
  '**/.mcp.json',
  // Editor, shell and git hooks
  '**/.vscode/**',
  '**/.idea/**',
  '**/.envrc',
  '**/.husky/**',
  '**/.githooks/**',
  '**/git-hooks/**',
  // git attributes
  '**/.gitattributes',
  '**/.gitmodules',
  // Package manager configuration
  '**/.npmrc',
  '**/.yarnrc',
  '**/.yarnrc.yml',
  // Dependency manifests and lockfiles
  '**/package.json',
  '**/package-lock.json',
  '**/npm-shrinkwrap.json',
  '**/yarn.lock',
  '**/pnpm-lock.yaml',
  '**/pnpm-workspace.yaml',
  '**/bun.lock',
  '**/bun.lockb',
  '**/go.mod',
  '**/go.sum',
  '**/go.work',
  '**/go.work.sum',
  '**/cargo.toml',
  '**/cargo.lock',
  '**/pyproject.toml',
  '**/poetry.lock',
  '**/pipfile',
  '**/pipfile.lock',
  '**/uv.lock',
  '**/requirements*.txt',
  '**/gemfile',
  '**/gemfile.lock',
]);

// Largest blob a content rule reads (design 5.4.1, "Readable"): 1 MiB.
export const CONTENT_MAX_BYTES = 1048576;

export const HALT_LABEL = 'pipeline-halt';

export const QUEUE_BRANCH = /^claude\/item-([a-z0-9][a-z0-9-]*)$/;
export const QUEUE_DIR = '.agent-line/queue';
export const REPORT_DIR = '.agent-line/reports';

// Precedence of design 3.1, first wins. `blocked` stands for every `blocked:*`
// verdict and `wait` for `wait:ci`, `wait:codex` and `wait:mergeable`.
export const VERDICT_ORDER = Object.freeze([
  'wait:halt',
  'wait:freeze',
  'blocked',
  'hold:owner',
  'hold:strong-review',
  'wait',
  'fix:ci',
  'fix:codex',
  'update:base',
  'merge',
]);
