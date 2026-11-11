import fs from 'node:fs/promises';
import path from 'node:path';
import spawn from 'cross-spawn';
import { killProcessTree } from '../../infrastructure/terminal/process-tree';
import { getProject } from '../projects';
import { effectiveGitSettings } from '../settings';
import { validateGitSettings } from '../settings';
import { isInside } from '../shared';
import { getWorkspace, updateWorkspace } from './store';
import { workspaceEnv } from './ports';
import { syncWorkspaceLibrary } from '../library';
import { serializeGit } from '../../infrastructure/git/write';

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

// Package managers rewrite their state files in place and tools keep caches here: through a link the main folder would change.
const UNSHARED_CACHES = new Set(['.cache', '.vite']);
/** Native builds (node-gyp, electron-rebuild) overwrite these files in place, so each workspace gets its own copy. */
function nativeBuild(relative: string): boolean {
  const parts = relative.split(path.sep);
  return relative.endsWith('.node') || parts.some((part, i) => part === 'build' && ['Release', 'Debug'].includes(parts[i + 1]));
}

/**
 * Mirror dependency folders (node_modules) of the main folder with hard links: seconds and almost no disk space.
 * The setup command then only installs what the branch adds. Across disks links are impossible and files are copied.
 */
export async function linkWorkspaceDirs(source: string, destination: string, dirs: string[], log: (text: string) => void, signal?: AbortSignal): Promise<void> {
  validateGitSettings({ workspace_link_dirs: dirs });
  let copyOnly = false;
  for (const dir of dirs) {
    const from = await safePath(source, dir), to = await safePath(destination, dir);
    const stat = await fs.lstat(from).catch(() => null);
    if (!stat?.isDirectory()) { log('Skipped ' + dir + ': no such folder in the main folder\n'); continue; }
    let linked = 0, copied = 0;
    const copy = async (file: string, target: string) => {
      await fs.copyFile(file, target).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'EEXIST') throw error; });
      copied++;
    };
    const visit = async (relative: string, top: boolean): Promise<void> => {
      signal?.throwIfAborted();
      const folder = path.join(from, relative), target = path.join(to, relative);
      await fs.mkdir(target, { recursive: true });
      const entries = await fs.readdir(folder, { withFileTypes: true });
      for (let i = 0; i < entries.length; i += 64) await Promise.all(entries.slice(i, i + 64).map(async entry => {
        const child = path.join(relative, entry.name), file = path.join(folder, entry.name), into = path.join(target, entry.name);
        if (entry.isSymbolicLink()) {
          // npm workspaces are junctions with absolute targets: one into the main folder must point into the workspace.
          const link = await fs.readlink(file);
          const absolute = path.resolve(folder, link);
          const next = path.isAbsolute(link) && isInside(source, absolute) ? path.join(destination, path.relative(source, absolute)) : link;
          const isDirectory = await fs.stat(file).then(s => s.isDirectory(), () => false);
          await fs.symlink(next, into, isDirectory ? 'junction' : 'file').catch((error: NodeJS.ErrnoException) => {
            // Windows needs a privilege for file symlinks: the file itself will do.
            if (error.code === 'EPERM' && !isDirectory) return copy(file, into);
            if (error.code !== 'EEXIST') throw error;
          });
        } else if (entry.isDirectory()) {
          if (!(top && UNSHARED_CACHES.has(entry.name))) await visit(child, false);
        } else if (entry.isFile()) {
          if (copyOnly || top || nativeBuild(child)) return copy(file, into);
          try { await fs.link(file, into); linked++; }
          catch (error) {
            const code = (error as NodeJS.ErrnoException).code;
            if (code === 'EEXIST') return;
            if (!['EXDEV', 'EPERM', 'ENOTSUP', 'EMLINK'].includes(code ?? '')) throw error;
            if (!copyOnly) log('Hard links are unavailable (' + code + ': the workspace is probably on another disk), copying instead\n');
            copyOnly = true;
            await copy(file, into);
          }
        }
      }));
    };
    await visit('', true);
    log('Linked ' + dir + ': ' + linked + ' files' + (copied ? ', copied ' + copied : '') + '\n');
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
  let output = '', written: ReturnType<typeof setTimeout> | undefined;
  // The log can reach 1 MB and every write is sent to all clients: write it at most a few times a second.
  const log = (text: string) => {
    output = (output + text).slice(-1024 * 1024);
    written ??= setTimeout(() => { written = undefined; try { updateWorkspace(id, { setup_log: output }); } catch { /* the workspace was removed meanwhile */ } }, 300);
  };
  updateWorkspace(id, { status: 'preparing', error: '', setup_log: '' });
  try {
    options.signal?.throwIfAborted();
    await copyWorkspaceFiles(project.repo_path, workspace.path, settings.workspace_copy_files, log);
    await linkWorkspaceDirs(project.repo_path, workspace.path, settings.workspace_link_dirs, log, options.signal);
    syncWorkspaceLibrary(project, workspace.path);
    if (settings.workspace_setup_command.trim()) {
      log('$ ' + settings.workspace_setup_command + '\n');
      await runSetupCommand(settings.workspace_setup_command, workspace.path,
        { ...process.env, ...project.config.extra_env, ...workspaceEnv(workspace) }, log, options.timeoutMs ?? 10 * 60_000, options.signal);
    }
    options.signal?.throwIfAborted();
    clearTimeout(written);
    return updateWorkspace(id, { status: 'ready', setup_log: output });
  } catch (error) {
    clearTimeout(written);
    return updateWorkspace(id, { status: 'failed', error: String(error), setup_log: output });
  }
}
