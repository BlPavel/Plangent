import fs from 'node:fs';
import path from 'node:path';
import type { Project } from '../../models';
import { moduleDependencies } from './dependencies';
import { syncWorkspaceLibrary } from './syncer';
import { withLibraryFiles } from './file-transaction';

type Snapshot = Record<string, string>;
interface Installation { paths: string[]; original: Snapshot; installed?: Snapshot }

function manifest(root: string): string { return root + '.instructions.json'; }

function saveInstallation(file: string, installation: Installation): void {
  const temporary = file + '.tmp';
  fs.writeFileSync(temporary, JSON.stringify(installation));
  fs.renameSync(temporary, file);
}

/** Layout paths are an explicit allowlist, never arbitrary project files or global folders. */
function checked(root: string, relative: string): string {
  const parts = relative.replace(/\\/g, '/').split('/');
  if (path.isAbsolute(relative) || parts.some(p => !p || p === '..' || p === '.' || p.toLowerCase() === '.git'))
    throw new Error('Invalid review instruction path: ' + relative);
  let current = root;
  for (const part of parts) {
    current = path.join(current, part);
    const stat = fs.lstatSync(current, { throwIfNoEntry: false });
    if (stat?.isSymbolicLink())
      throw new Error('Review instructions cannot follow links: ' + relative);
  }
  return current;
}

function snapshot(root: string, paths: string[]): Snapshot {
  const result: Snapshot = {};
  function visit(relative: string) {
    const file = checked(root, relative);
    if (!fs.existsSync(file)) return;
    const stat = fs.lstatSync(file);
    if (stat.isDirectory()) for (const name of fs.readdirSync(file).sort()) visit(relative + '/' + name);
    else if (stat.isFile()) result[relative] = fs.readFileSync(file).toString('base64');
    else throw new Error('Unsupported review instruction file: ' + relative);
  }
  for (const relative of paths) visit(relative);
  return result;
}

function same(a: Snapshot, b: Snapshot): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(key => a[key] === b[key]);
}

/** Delete only recorded instruction files and empty directories, preserving unrelated work. */
function restore(root: string, installation: Installation): void {
  const current = snapshot(root, installation.paths);
  if (installation.installed && !same(current, installation.installed))
    throw new Error('Review instruction files changed outside Plangent; refusing to overwrite them');
  for (const relative of Object.keys(current)) if (!(relative in installation.original)) {
    fs.unlinkSync(checked(root, relative));
    let directory = path.dirname(checked(root, relative));
    while (directory !== root && fs.readdirSync(directory).length === 0) {
      fs.rmdirSync(directory);
      directory = path.dirname(directory);
    }
  }
  for (const [relative, content] of Object.entries(installation.original)) {
    const file = checked(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.from(content, 'base64'));
  }
}

/** Caller holds the repository lock and keeps all agents using this worktree idle. */
export function prepareReviewLibrary(project: Project, root: string): boolean {
  const saved = manifest(root);
  const previous: Installation | null = fs.existsSync(saved) ? JSON.parse(fs.readFileSync(saved, 'utf8')) : null;
  const paths = new Set<string>();
  for (const agent of moduleDependencies.agents.listAgents(true)) {
    const profile = agent.layout_profile;
    for (const relative of [profile?.main?.file, profile?.skills?.dir, profile?.commands?.dir])
      if (relative) { checked(root, relative); paths.add(relative.replace(/\\/g, '/')); }
  }
  const local = snapshot(project.repo_path, [...paths]);
  for (const relative of previous?.paths ?? []) paths.add(relative);
  if (previous) restore(root, previous);
  const installation: Installation = { paths: [...paths], original: snapshot(root, [...paths]) };
  // Persist the baseline before writing so cleanup also works after an application restart.
  saveInstallation(saved, installation);
  try {
    for (const [relative, content] of Object.entries(local)) {
      const file = checked(root, relative);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, Buffer.from(content, 'base64'));
    }
    withLibraryFiles(() => syncWorkspaceLibrary(project, root));
    installation.installed = snapshot(root, installation.paths);
    saveInstallation(saved, installation);
    return !previous?.installed || !same(previous.installed, installation.installed);
  } catch (error) {
    restore(root, installation);
    fs.unlinkSync(saved);
    throw error;
  }
}

export function restoreReviewLibrary(root: string): void {
  const saved = manifest(root);
  if (!fs.existsSync(saved)) return;
  restore(root, JSON.parse(fs.readFileSync(saved, 'utf8')));
  fs.unlinkSync(saved);
}
