// The only place that spawns a process.
// `execFile` with an argument array and `shell: false`; never a command
// string, never a shell.
import { execFile } from 'node:child_process';

const ALLOWED = new Set(['git', 'gh']);

/**
 * @param {'git'|'gh'} cmd
 * @param {string[]} args
 * @param {{cwd?: string, maxBuffer?: number, timeoutMs?: number}} [options]
 * @returns {Promise<{stdout: Buffer, stderr: Buffer, code: number}>} resolves on any exit code;
 *   rejects when the process cannot be started, times out or exceeds maxBuffer
 */
export function run(cmd, args, { cwd, maxBuffer = 256 * 1024 * 1024, timeoutMs = 120_000 } = {}) {
  if (!ALLOWED.has(cmd)) return Promise.reject(new Error(`refusing to spawn ${cmd}`));
  if (!Array.isArray(args) || args.some((a) => typeof a !== 'string' || a.includes('\0'))) {
    return Promise.reject(new Error('arguments must be an array of strings without NUL'));
  }
  return new Promise((resolve, reject) => {
    execFile(cmd, args, {
      cwd,
      maxBuffer,
      timeout: timeoutMs,
      shell: false,
      encoding: 'buffer',
      windowsHide: true,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    }, (error, stdout, stderr) => {
      if (error && typeof error.code !== 'number') {
        reject(new Error(`${cmd} failed: ${error.killed ? 'timed out' : error.message}`));
      } else {
        resolve({ stdout, stderr, code: error ? error.code : 0 });
      }
    });
  });
}
