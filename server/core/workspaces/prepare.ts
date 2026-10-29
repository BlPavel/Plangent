import fs from 'node:fs/promises';
import path from 'node:path';
import spawn from 'cross-spawn';
import { killProcessTree } from '../../infrastructure/terminal/process-tree';
import { getProject, effectiveGitSettings } from '../projects';
import { validateGitSettings } from '../projects/git-settings';
import { isInside } from '../shared/paths';
import { getWorkspace, updateWorkspace } from './store';
import { syncWorkspaceLibrary } from '../library/syncer';
import { serializeGit } from '../code/git-write';

/** Common shell globs, also on Electron's Node versions without fs.glob. */
function globRegex(pattern: string): RegExp {
  let result = '^', braces = 0;
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*' && pattern[i + 1] === '*') {
      i++;
      if (pattern[i + 1] === '/') { i++; result += '(?:.*/)?'; }
      else result += '.*';
    } else if (c === '*') result += '[^/]*';
    else if (c === '?') result += '[^/]';
    else if (c === '{') { braces++; result += '(?:'; }
    else if (c === '}' && braces) { braces--; result += ')'; }
    else if (c === ',' && braces) result += '|';
    else if (c === '[' && pattern.indexOf(']', i + 1) > i + 1) {
      const end = pattern.indexOf(']', i + 1);
      result += '[' + pattern.slice(i + 1, end).replace(/^!/, '^') + ']'; i = end;
    } else result += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(result + '$');
}

function matchesPrefix(parts: string[], pattern: string[], index = 0, offset = 0): boolean {
  if (index === parts.length) return true;
  if (offset === pattern.length) return false;
  if (pattern[offset] === '**') return matchesPrefix(parts, pattern, index, offset + 1) || matchesPrefix(parts, pattern, index + 1, offset);
  return globRegex(pattern[offset]).test(parts[index]) && matchesPrefix(parts, pattern, index + 1, offset + 1);
}

/** Refuse symlinks/junctions on either side, including existing destination ancestors. */
async function safePath(root: string, relative: string): Promise<string> {
  const target = path.resolve(root, relative);
  if (!isInside(root, target) || relative.split(/[/\\]/).some(p => p.toLowerCase() === '.git')) throw new Error('Copy path escapes workspace');
  let current = root;
  for (const part of path.relative(root, target).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    const stat = await fs.lstat(current).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; return null; });
    if (stat?.isSymbolicLink()) throw new Error('Workspace copy cannot follow links: ' + relative);
  }
  return target;
}
export async function copyWorkspaceFiles(source: string, destination: string, patterns: string[], log: (text: string) => void): Promise<void> {
  validateGitSettings({ workspace_copy_files: patterns });
  const copied = new Set<string>();
  async function copy(relative: string): Promise<void> {
    if (copied.has(relative)) return;
    const from = await safePath(source, relative), to = await safePath(destination, relative);
    const stat = await fs.lstat(from);
    if (stat.isDirectory()) {
      for (const child of await fs.readdir(from)) if (child.toLowerCase() !== '.git') await copy(path.join(relative, child));
    } else if (stat.isFile()) {
      await fs.mkdir(path.dirname(to), { recursive: true });
      await fs.copyFile(from, to);
      copied.add(relative);
      log('Copied ' + relative + '\n');
    } else throw new Error('Unsupported workspace copy entry: ' + relative);
  }
  for (const pattern of patterns) {
    const matcher = globRegex(pattern);
    const parts = pattern.split('/');
    const firstWildcard = parts.findIndex(part => /[*?{[]/.test(part));
    if (firstWildcard === -1) {
      if (await fs.lstat(path.resolve(source, pattern)).then(() => true, () => false)) await copy(pattern);
      continue;
    }
    async function visit(relative: string): Promise<void> {
      if (relative && !matchesPrefix(relative.split(path.sep), parts)) return;
      const absolute = await safePath(source, relative);
      const stat = await fs.lstat(absolute).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; return null; });
      if (!stat) return;
      if (relative && matcher.test(relative.replace(/\\/g, '/'))) { await copy(relative); return; }
      if (stat.isDirectory()) for (const child of await fs.readdir(absolute)) {
        if (child.toLowerCase() !== '.git') await visit(path.join(relative, child));
      }
    }
    await visit(parts.slice(0, firstWildcard).join('/'));
  }
}

export function runSetupCommand(command: string, cwd: string, env: NodeJS.ProcessEnv, log: (text: string) => void, timeoutMs: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(command, [], { cwd, env, shell: true, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    let failure: Error | undefined, killing: Promise<void> | undefined;
    const stop = (error: Error) => { failure ??= error; killing ??= killProcessTree(child.pid); };
    const abort = () => stop(new Error('Workspace setup cancelled'));
    const timer = setTimeout(() => stop(new Error('Workspace setup timed out')), timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    child.stdout?.on('data', chunk => log(String(chunk)));
    child.stderr?.on('data', chunk => log(String(chunk)));
    child.once('error', error => { failure ??= error; });
    child.once('close', async code => {
      clearTimeout(timer); signal?.removeEventListener('abort', abort);
      await killing;
      if (failure) reject(failure);
      else if (code !== 0) reject(new Error('Workspace setup exited with code ' + code));
      else resolve();
    });
  });
}

export async function prepareWorkspace(id: string, options: { timeoutMs?: number; signal?: AbortSignal } = {}) {
  const project = getProject(getWorkspace(id).project_id);
  if (!project || project.kind !== 'project') throw new Error('Workspace is unavailable');
  return serializeGit(project.repo_path, () => prepare(id, options));
}

async function prepare(id: string, options: { timeoutMs?: number; signal?: AbortSignal }) {
  const workspace = getWorkspace(id), project = getProject(workspace.project_id);
  if (!project || workspace.status === 'removed') throw new Error('Workspace is unavailable');
  const settings = effectiveGitSettings(project.id).values;
  let output = '';
  const log = (text: string) => {
    output = (output + text).slice(-1024 * 1024);
    updateWorkspace(id, { setup_log: output });
  };
  updateWorkspace(id, { status: 'preparing', error: '', setup_log: '' });
  try {
    options.signal?.throwIfAborted();
    await copyWorkspaceFiles(project.repo_path, workspace.path, settings.workspace_copy_files, log);
    syncWorkspaceLibrary(project, workspace.path);
    if (settings.workspace_setup_command.trim()) {
      log('$ ' + settings.workspace_setup_command + '\n');
      await runSetupCommand(settings.workspace_setup_command, workspace.path,
        { ...process.env, ...project.config.extra_env }, log, options.timeoutMs ?? 10 * 60_000, options.signal);
    }
    options.signal?.throwIfAborted();
    return updateWorkspace(id, { status: 'ready' });
  } catch (error) {
    return updateWorkspace(id, { status: 'failed', error: String(error), setup_log: output });
  }
}
