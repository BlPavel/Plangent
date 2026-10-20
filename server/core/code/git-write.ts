import { AsyncLocalStorage } from 'node:async_hooks';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { codePath, CodeError } from './files';
import { assembleCommitMessage, inspectCommitMessage, type CommitMessageInput } from './commit-message';
import type { GitSettings } from '../projects/git-settings';
import { isRepository, localBranchHead, repositoryInfo, branches } from './git';

export interface GitOperationOptions {
  signal?: AbortSignal; timeoutMs?: number; onOutput?: (chunk: string) => void;
  assertIdle?: () => void;
}
export class GitOperationError extends CodeError {
  constructor(message: string, public output = '', public code = 'git_failed') { super(message, 409); }
}
const queues = new Map<string, Promise<unknown>>();
const ownership = new AsyncLocalStorage<{ key: string; active: boolean }>();
export async function serializeGit<T>(root: string, operation: () => Promise<T>): Promise<T> {
  const canonical = await fs.realpath(root);
  const key = process.platform === 'win32' ? canonical.toLowerCase() : canonical;
  if (ownership.getStore()?.key === key && ownership.getStore()?.active) return operation();
  const previous = queues.get(key) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(() => {
    const owner = { key, active: true };
    return ownership.run(owner, async () => { try { return await operation(); } finally { owner.active = false; } });
  });
  queues.set(key, next);
  try { return await next; } finally { if (queues.get(key) === next) queues.delete(key); }
}
export function redactGitOutput(text: string): string {
  return text.replace(/(https?:\/\/)[^\s/@]+(?::[^\s/@]*)?@/gi, '$1***@');
}
const run = runGit;
export function runGit(root: string, args: string[], options: GitOperationOptions = {}, input?: string): Promise<string> {
  options.signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    let output = '', cancelled = false, timedOut = false, terminating = false, killError: Error | undefined;
    const child = execFile('git', ['-c', 'core.quotepath=off', '--literal-pathspecs', ...args], {
      cwd: root, windowsHide: true, maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_PAGER: 'cat', GCM_INTERACTIVE: 'never' },
    }, (error, stdout) => {
      clearTimeout(timer); options.signal?.removeEventListener('abort', abort);
      if (killError) return reject(killError);
      if (cancelled || timedOut) return reject(new GitOperationError(timedOut ? 'Git operation timed out' : 'Git operation cancelled', output, timedOut ? 'timeout' : 'cancelled'));
      if (error) {
        const auth = /authentication failed|could not read Username|permission denied|access denied|HTTP Basic: Access denied|terminal prompts disabled/i.test(output);
        const divergence = args[0] === 'pull' && /diverg|fast-forward|not possible to fast-forward/i.test(output);
        return reject(new GitOperationError(auth ? 'Ошибка авторизации. Для SSO используйте PAT вместо пароля или SSH.' : divergence ? 'Ветки разошлись. Откройте внешний Git-клиент.' : 'Git operation failed', output, auth ? 'authentication' : divergence ? 'diverged' : 'git_failed'));
      }
      resolve(stdout);
    });
    const collect = (chunk: Buffer | string) => { const text = redactGitOutput(String(chunk)); output = (output + text).slice(-1024 * 1024); options.onOutput?.(text); };
    child.stdout?.on('data', collect); child.stderr?.on('data', collect);
    const kill = () => {
      if (!child.pid || terminating) return;
      terminating = true;
      if (process.platform === 'win32') {
        // MSYS forked children may have a native parent outside taskkill's tree.
        // Capture their logical parent IDs before terminating the native tree.
        execFile('git', ['--exec-path'], { windowsHide: true }, (_error, execPath) => {
          const ps = path.resolve(execPath.trim(), '../../../usr/bin/ps.exe');
          execFile(ps, ['-W'], { windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (_psError, listing) => {
            const rows = listing.split('\n').flatMap(line => {
              const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s/.exec(line);
              return match ? [{ pid: Number(match[1]), parent: Number(match[2]), native: Number(match[4]) }] : [];
            });
            execFile('taskkill.exe', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }, async (error, stdout) => {
              if (error && child.exitCode === null) { killError = error; child.kill(); }
              const killed = new Set([child.pid!, ...[...stdout.matchAll(/\d+/g)].map(match => Number(match[0]))]);
              const logical = new Set(rows.filter(row => killed.has(row.native)).map(row => row.pid));
              let previous = -1;
              while (previous !== logical.size) {
                previous = logical.size;
                for (const row of rows) if (logical.has(row.parent)) logical.add(row.pid);
              }
              for (const row of rows.filter(row => logical.has(row.pid) && !killed.has(row.native))) {
                await new Promise<void>(resolve => execFile('taskkill.exe', ['/pid', String(row.native), '/T', '/F'], { windowsHide: true }, () => resolve()));
              }
              child.stdin?.destroy(); child.stdout?.destroy(); child.stderr?.destroy();
            });
          });
        });
      }
      else execFile('ps', ['-eo', 'pid=,ppid='], { windowsHide: true }, (error, stdout) => {
        const descendants = new Set<number>([child.pid!]);
        if (!error) {
          const rows = stdout.trim().split('\n').map(line => line.trim().split(/\s+/).map(Number));
          let previous = 0;
          while (previous !== descendants.size) {
            previous = descendants.size;
            for (const [pid, parent] of rows) if (descendants.has(parent)) descendants.add(pid);
          }
        }
        for (const pid of [...descendants].reverse()) { try { process.kill(pid, 'SIGKILL'); } catch { /* already exited */ } }
      });
    };
    const abort = () => { cancelled = true; kill(); };
    const timer = setTimeout(() => { timedOut = true; kill(); }, options.timeoutMs ?? 120000);
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) abort();
    child.stdin?.end(input);
  });
}
async function check(root: string, options: GitOperationOptions, idle = false) {
  options.signal?.throwIfAborted();
  if (!await isRepository(root)) throw new CodeError('Project is not a Git repository');
  if (idle) options.assertIdle?.();
}
function files(root: string, list: string[]): string[] {
  if (!Array.isArray(list) || !list.length || list.length > 10000 || list.some(file => typeof file !== 'string')) throw new CodeError('Choose files');
  return list.map(file => path.relative(root, codePath(root, file)).replace(/\\/g, '/'));
}
export async function stage(root: string, paths: string[], options: GitOperationOptions = {}) {
  const list = files(root, paths);
  return serializeGit(root, async () => { await check(root, options, true); return run(root, ['add', '-A', '--', ...list], options); });
}
export async function unstage(root: string, paths: string[], options: GitOperationOptions = {}) {
  const list = files(root, paths);
  return serializeGit(root, async () => {
    await check(root, options, true);
    const info = await repositoryInfo(root);
    return run(root, info?.head ? ['restore', '--staged', '--', ...list] : ['rm', '--cached', '-r', '--ignore-unmatch', '--', ...list], options);
  });
}
export async function fetchRepository(root: string, options: GitOperationOptions = {}) {
  return serializeGit(root, async () => { await check(root, options); return run(root, ['fetch', '--progress', '--prune', 'origin', '+refs/heads/*:refs/remotes/origin/*'], options); });
}
export async function pull(root: string, options: GitOperationOptions = {}) {
  return serializeGit(root, async () => { await check(root, options, true); return run(root, ['pull', '--ff-only', '--progress'], options); });
}
/** Replays local commits on top of the upstream; on a failure the rebase is aborted so the folder is left as it was. */
export async function pullRebase(root: string, options: GitOperationOptions = {}) {
  return serializeGit(root, async () => {
    await check(root, options, true);
    try { return await run(root, ['pull', '--rebase', '--progress'], options); }
    catch (error) {
      await run(root, ['rebase', '--abort']).catch(() => undefined);
      if (error instanceof GitOperationError && error.code === 'git_failed')
        throw new GitOperationError('Rebase не удался: конфликты или незакоммиченные изменения. Он отменён, ничего не изменилось.', error.output, 'rebase_failed');
      throw error;
    }
  });
}
export async function push(root: string, options: GitOperationOptions = {}, force = false) {
  return serializeGit(root, async () => {
    await check(root, options, true);
    const info = await repositoryInfo(root);
    if (!info?.branch) throw new CodeError('Choose a branch before pushing');
    const upstream = await run(root, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], options).catch(() => '');
    return run(root, upstream ? ['push', '--progress', ...(force ? ['--force-with-lease'] : [])] : ['push', '--progress', '--set-upstream', 'origin', info.branch], options);
  });
}
export async function switchBranch(root: string, branch: string, options: GitOperationOptions = {}) {
  return serializeGit(root, async () => {
    await check(root, options, true);
    if (typeof branch !== 'string') throw new CodeError('Invalid branch name');
    const selected = (await branches(root)).find(item => item.name === branch);
    if (!selected) throw new CodeError('Branch not found');
    if (!selected.remote) return run(root, ['switch', '--no-guess', '--', branch], options);
    const local = branch.replace(/^origin\//, '');
    if (await localBranchHead(root, local)) return run(root, ['switch', '--no-guess', '--', local], options);
    // Single-branch clones need a persistent mapping so Git can resolve the new upstream.
    const mappings = (await run(root, ['config', '--get-all', 'remote.origin.fetch'], options)).trim().split('\n').map(value => value.replace(/^\+/, ''));
    if (!mappings.includes('refs/heads/*:refs/remotes/origin/*') && !mappings.includes('refs/heads/' + local + ':' + selected.ref))
      await run(root, ['remote', 'set-branches', '--add', 'origin', local], options);
    return run(root, ['switch', '--track', '-c', local, selected.ref], options);
  });
}
export async function createBranch(root: string, name: string, base: string, options: GitOperationOptions = {}) {
  return serializeGit(root, async () => {
    await check(root, options, true);
    if (typeof name !== 'string' || name.startsWith('-')) throw new CodeError('Invalid branch name');
    const checkedName = (await run(root, ['check-ref-format', '--branch', name], options)).trim();
    if (checkedName !== name) throw new CodeError('Use an explicit branch name');
    const source = (await branches(root)).find(branch => branch.name === base);
    if (!source) throw new CodeError('Base branch not found');
    return run(root, ['switch', '-c', name, source.ref], options);
  });
}
/** Reserved for finish reassembly: the workflow must provide its original HEAD. No HTTP route. */
export async function resetForReassembly(root: string, base: string, expectedHead: string, options: GitOperationOptions = {}) {
  return serializeGit(root, async () => {
    await check(root, options, true);
    if (!/^[a-f0-9]{40,64}$/.test(base) || !/^[a-f0-9]{40,64}$/.test(expectedHead)) throw new CodeError('Invalid commit');
    if ((await repositoryInfo(root))?.head !== expectedHead) throw new GitOperationError('HEAD changed; reassembly is unavailable');
    await run(root, ['merge-base', '--is-ancestor', base, expectedHead], options);
    return run(root, ['reset', '--mixed', base], options);
  });
}
export async function cloneRepository(url: string, destination: string, options: GitOperationOptions = {}) {
  // Parent is the queue key, since the destination does not exist yet.
  return serializeGit(path.dirname(destination), async () => run(path.dirname(destination), ['clone', '--progress', '--', url, destination], options));
}

/** The only application commit path, also reused by finish. Settings are resolved inside the queue. */
export async function commit(root: string, input: CommitMessageInput, getSettings: () => GitSettings, options: GitOperationOptions = {}, overrideForbidden = false) {
  return serializeGit(root, async () => {
    await check(root, options, true);
    const settings = getSettings();
    let message: string;
    try { message = assembleCommitMessage({ ...input, includeDescription: input.includeDescription ?? settings.include_description }); }
    catch (error) { throw new CodeError((error as Error).message); }
    if (message.length > 1024 * 1024) throw new CodeError('Commit message too large');
    const violations = inspectCommitMessage({ ...input, includeDescription: input.includeDescription ?? settings.include_description }, settings).violations;
    if (violations.some(item => item.kind === 'forbidden') && !overrideForbidden)
      throw new GitOperationError('Forbidden text in commit message. Explicit override is required.', '', 'forbidden_message');
    // Team format rules are warnings; only forbidden attribution requires an explicit override.
    return run(root, ['commit', '--cleanup=verbatim', '--file=-'], options, message + '\n');
  });
}

/** Overwrites the remote branch only if nobody pushed to it since our last fetch. */
export const pushForce = (root: string, options: GitOperationOptions = {}) => push(root, options, true);
