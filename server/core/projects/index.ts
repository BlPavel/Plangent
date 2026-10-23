import fs from 'fs';
import { execFileSync } from 'child_process';
import { originUrl, isRepository } from '../code/git';
import { cloneRepository, type GitOperationOptions } from '../code/git-write';
import { CodeError } from '../code/files';
import { parseRemoteUrl, sameRemote, publicRemoteUrl } from './remote-url';
import { resolveGitSettings, validateGitSettings, type GitSettings } from './git-settings';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { DATA_DIR, getDb } from '../../infrastructure/db/schema';
import { checkedFile } from '../docs-sources/sync';
import { validateConfig } from '../docs-sources/config';
import { sourceFolder, isDocsSyncRunning } from '../docs-sources';
import { listConnections, requireConnection } from '../integrations';
import { DocsSelection, SourceType } from '../../models/integrations';
import { slugify } from '../shared/slugify';
import { Project, ProjectConfig, ProjectKind } from '../../models';

function parse(row: Record<string, unknown>): Project {
  const project: Project = {
    ...(row as Omit<Project, 'config' | 'hide_from_git'>),
    config: JSON.parse(row.config as string || '{}'),
    git_settings: JSON.parse(row.git_settings as string || '{}'),
    hide_from_git: Boolean(row.hide_from_git),
    docs_config: JSON.parse(row.docs_config as string || '{}'),
    docs_selection: JSON.parse(row.docs_selection as string || '[]'),
    sync_stats: JSON.parse(row.sync_stats as string || '{}'),
  };
  // Legacy visibility settings no longer apply: references are supplied only by explicit mention.
  if (project.kind === 'source') delete (project.config as Record<string, unknown>).available_everywhere;
  return project;
}

export function listProjects(kind?: ProjectKind): Project[] {
  const rows = kind
    ? getDb().prepare('SELECT * FROM projects WHERE kind=? ORDER BY name COLLATE NOCASE').all(kind)
    : getDb().prepare('SELECT * FROM projects ORDER BY name COLLATE NOCASE').all();
  return (rows as Record<string, unknown>[]).map(parse);
}

export function getProject(id: string): Project | null {
  const row = getDb().prepare('SELECT * FROM projects WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return row ? parse(row) : null;
}

export function getProjectByKey(key: string): Project | null {
  const row = getDb().prepare(`SELECT * FROM projects WHERE key = ? AND kind <> 'group'`).get(key) as Record<string, unknown> | undefined;
  return row ? parse(row) : null;
}

export function groupMembers(groupId: string): Project[] {
  return (getDb().prepare(`SELECT * FROM projects WHERE group_id=? AND kind='project' ORDER BY name COLLATE NOCASE`).all(groupId) as Record<string, unknown>[]).map(parse);
}

/** A user-facing validation problem; routes answer it with 400. */
export class ProjectError extends Error {}

const KEY = /^[a-z0-9][a-z0-9._-]*$/;

function uniqueKey(base: string, exceptId?: string): string {
  let key = base;
  for (let n = 2; getProjectByKey(key) && getProjectByKey(key)!.id !== exceptId; n++) key = `${base}-${n}`;
  return key;
}

function checkKey(key: string, exceptId?: string): void {
  if (!KEY.test(key)) throw new ProjectError('Ключ: латиница в нижнем регистре, цифры, «-», «.» и «_»');
  const taken = getProjectByKey(key);
  if (taken && taken.id !== exceptId) throw new ProjectError(`Ключ «${key}» уже занят: ${taken.name}`);
}

/** A folder can be a project or a source, not both: a project is already referenced as @its-key. */
function checkPath(kind: ProjectKind, repoPath: string, exceptId?: string): void {
  if (kind === 'group') return;
  const canonical = (folder: string) => { const resolved = fs.existsSync(folder) ? fs.realpathSync(folder) : path.resolve(folder); return process.platform === 'win32' ? resolved.toLowerCase() : resolved; };
  const resolved = canonical(repoPath);
  const twin = listProjects().find(p => p.id !== exceptId && p.kind !== 'group' && canonical(p.repo_path) === resolved);
  if (twin) throw new ProjectError(twin.kind === 'source'
    ? `Эта папка уже добавлена как справочник @${twin.key}`
    : `Эта папка уже добавлена как проект «${twin.name}» — ссылайтесь на неё как @${twin.key}`);
}

function checkGroup(groupId: string | null | undefined, kind: ProjectKind): void {
  if (!groupId) return;
  if (kind !== 'project') throw new ProjectError('В группу можно добавить только проект');
  if (getProject(groupId)?.kind !== 'group') throw new ProjectError('Группа не найдена');
}

export const groupFolder = (id: string) => path.join(DATA_DIR, 'groups', id);

/** The actual `origin` of a member folder (not a stored copy), without credentials, for the group README. */
function syncOrigin(root: string): string {
  try {
    return execFileSync('git', ['-C', root, 'config', '--get', 'remote.origin.url'], { encoding: 'utf-8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] })
      .trim().replace(/\/\/[^/@]*@/, '//');
  }
  catch {
    return '';
  }
}

/**
 * The group's working folder: its projects live anywhere on disk, so the agent starts here and the README
 * tells it where they are (they are also passed as additional directories when the agent supports it).
 */
export function writeGroupReadme(groupId: string): void {
  const group = getProject(groupId);
  if (group?.kind !== 'group') return;
  fs.mkdirSync(group.repo_path, { recursive: true });
  const members = groupMembers(groupId);
  const lines = [
    `# ${group.name}`, '',
    ...(group.description ? [group.description, ''] : []),
    'Это рабочая папка группы проектов Plangent. Сами проекты лежат в других местах:', '',
    ...members.map(p => {
      const origin = syncOrigin(p.repo_path);
      return `- **${p.name}** (\`@${p.key}\`): \`${p.repo_path}\`${origin ? `, origin: \`${origin}\`` : ''}${p.description ? ` — ${p.description}` : ''}`;
    }),
    ...(members.length ? [] : ['- (в группе пока нет проектов)']), '',
    'Изменения вносите в папках проектов выше. Читайте только то, что нужно для задачи.', '',
  ];
  fs.writeFileSync(path.join(group.repo_path, 'README.md'), lines.join('\n'), 'utf-8');
}

export interface ProjectInput {
  kind?: ProjectKind;
  name: string;
  key?: string | null;
  repo_path?: string;
  group_id?: string | null;
  icon?: string;
  description?: string;
  default_agent_id?: string | null;
  config?: ProjectConfig;
  hide_from_git?: boolean;
  clone_url?: string;
  host_project_path?: string;
  git_settings?: Partial<GitSettings>;
  source_type?: SourceType;
  connection_id?: string | null;
  docs_config?: Record<string, unknown>;
  docs_selection?: DocsSelection[];
}

function validateSourceVisibility(kind: ProjectKind, data: Partial<ProjectInput>): void {
  if (kind === 'source' && ('targets' in data || (data.config && 'available_everywhere' in data.config)))
    throw new ProjectError('Справочники подключаются только вручную через @упоминание');
}


function docsSettings(data: Partial<ProjectInput>, current?: Project) {
  const type = data.source_type ?? current?.source_type ?? 'folder';
  if (!['folder', 'docs'].includes(type)) throw new ProjectError('Invalid source type');
  if (current && type !== current.source_type) throw new ProjectError('Source type cannot be changed');
  if (type !== 'docs') {
    const connection = data.connection_id === undefined ? current?.connection_id ?? null : data.connection_id;
    if (connection) requireConnection(connection);
    return { type, connection, config: {}, selection: [] };
  }
  if ((current?.kind ?? data.kind) !== 'source') throw new ProjectError('Docs type is only for reference sources');
  const connection = data.connection_id ?? current?.connection_id;
  if (!connection) throw new ProjectError('Choose a connection');
  requireConnection(connection);
  const config = validateConfig(data.docs_config ?? current?.docs_config);
  const selection = data.docs_selection ?? current?.docs_selection ?? [];
  if (!Array.isArray(selection) || selection.length > 10000 || selection.some(s =>
    !s || typeof s.id !== 'string' || !s.id || s.id.length > 512 || typeof s.include_descendants !== 'boolean' ||
    (s.excluded_ids !== undefined && (!Array.isArray(s.excluded_ids) || s.excluded_ids.some(id => typeof id !== 'string' || !id || id.length > 512)))
  )) throw new ProjectError('Invalid document selection');
  return { type, connection, config, selection };
}
function saveDocsSettings(id: string, settings: ReturnType<typeof docsSettings>): void {
  getDb().prepare('UPDATE projects SET source_type=?,connection_id=?,docs_config=?,docs_selection=? WHERE id=?')
    .run(settings.type, settings.connection, JSON.stringify(settings.config), JSON.stringify(settings.selection), id);
}

export function createProject(data: ProjectInput): Project {
  validateSourceVisibility(data.kind ?? 'project', data);
  const kind = data.kind ?? 'project';
  if (!['project', 'group', 'source'].includes(kind)) throw new ProjectError('Invalid project kind');
  const settings = docsSettings(data);
  const git = gitData(data);
  const id = uuidv4();
  if (!data.name?.trim()) throw new ProjectError('Укажите название');
  if (kind !== 'group' && settings.type !== 'docs' && !data.repo_path) throw new ProjectError('Укажите папку');
  const repoPath = kind === 'group' ? groupFolder(id) : settings.type === 'docs' ? sourceFolder(id) : data.repo_path!;
  if (settings.type === 'docs') checkedFile(repoPath, 'INDEX.md');
  checkPath(kind, repoPath);
  checkGroup(data.group_id, kind);
  let key: string | null = null;
  if (kind !== 'group') {
    key = data.key?.trim() || uniqueKey(slugify(data.name));
    checkKey(key);
  }
  getDb().prepare(`
    INSERT INTO projects (id, kind, name, key, repo_path, group_id, icon, description, default_agent_id, config, hide_from_git)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, kind, data.name.trim(), key, repoPath, data.group_id ?? null, data.icon ?? '', data.description ?? '',
    data.default_agent_id ?? null, JSON.stringify(data.config ?? {}), data.hide_from_git === false ? 0 : 1);
  saveDocsSettings(id, settings);
  saveGitData(id, git);
  if (settings.type === 'docs') fs.mkdirSync(repoPath, { recursive: true });
  if (kind === 'group') writeGroupReadme(id);
  if (data.group_id) writeGroupReadme(data.group_id);
  return getProject(id)!;
}

export function updateProject(id: string, data: Partial<ProjectInput>): Project | null {
  const current = getProject(id);
  if (!current) return null;
  validateSourceVisibility(current.kind, data);
  if (isDocsSyncRunning(id)) throw new ProjectError('Cancel sync before changing the source');
  const settings = docsSettings(data, current);
  const git = gitData({ ...current, ...data });
  const u = { ...current, ...data, config: data.config ?? current.config };
  if (settings.type === 'docs') u.repo_path = sourceFolder(id);
  if (!u.name?.trim()) throw new ProjectError('Укажите название');
  if (current.kind === 'group') u.repo_path = current.repo_path;
  else {
    u.key = (u.key ?? '').trim();
    checkKey(u.key, id);
    if (u.repo_path !== current.repo_path) checkPath(current.kind, u.repo_path, id);
  }
  if (u.group_id === id) throw new ProjectError('Группа не может входить в саму себя');
  checkGroup(u.group_id, current.kind);
  getDb().prepare(`
    UPDATE projects SET name=?, key=?, repo_path=?, group_id=?, icon=?, description=?, default_agent_id=?, config=?, hide_from_git=? WHERE id=?
  `).run(u.name.trim(), current.kind === 'group' ? null : u.key, u.repo_path, u.group_id ?? null, u.icon ?? '', u.description ?? '',
    u.default_agent_id ?? null, JSON.stringify(u.config), u.hide_from_git ? 1 : 0, id);
  saveDocsSettings(id, settings);
  saveGitData(id, git);
  for (const group of new Set([current.group_id, u.group_id, current.kind === 'group' ? id : null])) if (group) writeGroupReadme(group);
  return getProject(id);
}

/** Deleting a group keeps its projects (they leave the group); its own tasks and chats go with it. */
export function deleteProject(id: string): boolean {
  const current = getProject(id);
  if (!current) return false;
  if (isDocsSyncRunning(id)) throw new ProjectError('Cancel sync before deleting the source');
  if (current.source_type === 'docs') {
    const root = sourceFolder(id);
    if (path.resolve(current.repo_path) !== path.resolve(root) || (fs.existsSync(root) && fs.lstatSync(root).isSymbolicLink())) throw new ProjectError('Unsafe managed source directory');
    for (let dir = path.dirname(root); ; dir = path.dirname(dir)) {
      if (fs.existsSync(dir) && fs.lstatSync(dir).isSymbolicLink()) throw new ProjectError('Unsafe managed source directory');
      if (path.dirname(dir) === dir) break;
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
  const deleted = getDb().prepare('DELETE FROM projects WHERE id = ?').run(id).changes > 0;
  // Only ever the service folder Plangent created itself.
  if (current.kind === 'group' && path.resolve(current.repo_path) === path.resolve(groupFolder(id))) {
    fs.rmSync(current.repo_path, { recursive: true, force: true });
  }
  if (current.group_id) writeGroupReadme(current.group_id);
  return deleted;
}

function gitData(data: Pick<ProjectInput, 'clone_url' | 'host_project_path' | 'git_settings'>) {
  try {
    for (const value of [data.clone_url, data.host_project_path]) if (value !== undefined && (typeof value !== 'string' || value.length > 4096)) throw new Error('Invalid git data');
    return { url: publicRemoteUrl(data.clone_url ?? ''), hostPath: data.host_project_path ?? '', settings: validateGitSettings(data.git_settings ?? {}) };
  } catch (error) { throw new ProjectError((error as Error).message); }
}
function saveGitData(id: string, data: ReturnType<typeof gitData>) {
  getDb().prepare('UPDATE projects SET clone_url=?,host_project_path=?,git_settings=? WHERE id=?')
    .run(data.url, data.hostPath, JSON.stringify(data.settings), id);
}
export function effectiveGitSettings(id: string) {
  const project = getProject(id);
  if (!project) throw new ProjectError('Project not found');
  return resolveGitSettings(project.group_id ? getProject(project.group_id)?.git_settings : {}, project.git_settings, globalGitSettings());
}

/** App-wide git settings («Настройки»): the level under every group and project. */
export function globalGitSettings(): Partial<GitSettings> {
  const row = getDb().prepare("SELECT value FROM app_settings WHERE key = 'git-settings'").get() as { value: string } | undefined;
  try { return row ? validateGitSettings(JSON.parse(row.value)) : {}; } catch { return {}; }
}
export function saveGlobalGitSettings(value: unknown) {
  let settings: Partial<GitSettings>;
  try { settings = validateGitSettings(value); } catch (error) { throw new ProjectError((error as Error).message); }
  getDb().prepare(`INSERT INTO app_settings (key, value, updated_at) VALUES ('git-settings', ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).run(JSON.stringify(settings));
  return settings;
}

/** Who does the git work (commit messages, commit split, MR description): the configured agent, else the project's. */
export function gitAgent(id: string) { return configuredAgent(id, 'git', 'Выберите агента для коммитов и МР в настройках'); }
/** Who reviews code with the developer: the configured review agent, else the project's. */
export function reviewAgent(id: string) { return configuredAgent(id, 'review', 'Выберите агента для ревью в настройках проекта'); }
function configuredAgent(id: string, kind: 'git' | 'review', missing: string): { agentId: string; model: string; effort: string } {
  const settings = effectiveGitSettings(id).values;
  const own = settings[`${kind}_agent_id`];
  const agentId = own || getProject(id)?.default_agent_id || '';
  if (!agentId) throw new CodeError(missing);
  // A model or effort only makes sense for the agent it was picked for.
  return own ? { agentId, model: settings[`${kind}_agent_model`], effort: settings[`${kind}_agent_effort`] } : { agentId, model: '', effort: '' };
}

export interface CreateProjectOptions extends GitOperationOptions { reuseExisting?: boolean }
export class ExistingCloneError extends ProjectError { code = 'reuse_existing'; }
/** Called by HTTP creation, leaving synchronous creation compatible with internal migrations/tests. */
export async function createProjectFromFolder(data: ProjectInput, clone = false, options: CreateProjectOptions = {}): Promise<Project> {
  if ((data.kind ?? 'project') !== 'project') {
    if (clone) throw new ProjectError('Only projects can be cloned');
    return createProject(data);
  }
  if (!data.repo_path || !path.isAbsolute(data.repo_path)) throw new ProjectError('Choose an absolute folder path');
  if (!data.name?.trim()) throw new ProjectError('Enter a project name');
  checkGroup(data.group_id, 'project');
  if (data.key?.trim()) checkKey(data.key.trim());
  docsSettings(data); gitData(data);
  let destination = path.resolve(data.repo_path), owned = false;
  let ownedIdentity: fs.Stats | undefined;
  checkPath('project', destination);
  if (clone) {
    if (!data.clone_url || /[\r\n\0]/.test(data.clone_url) || data.clone_url.startsWith('-')) throw new ProjectError('Invalid clone URL');
    const parsed = parseRemoteUrl(data.clone_url);
    if (!parsed && !path.isAbsolute(data.clone_url) && !/^file:\/\//i.test(data.clone_url)) throw new ProjectError('Use an SSH or HTTPS Git URL');
    if (parsed && /^(https?):\/\//i.test(data.clone_url)) {
      const url = new URL(data.clone_url);
      if (url.password || url.username) throw new ProjectError('Store credentials in Git credential manager, not in the clone URL');
    }
    // Resolve the parent first, then reserve only the exact leaf. No recursive deletion of user folders.
    const parent = await fs.promises.realpath(path.dirname(destination));
    destination = path.join(parent, path.basename(destination));
    checkPath('project', destination);
    const exists = await fs.promises.lstat(destination).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; });
    if (exists) {
      if (!await isRepository(destination)) throw new ProjectError('Destination already exists. Choose another folder.');
      const origin = await originUrl(destination);
      if (!origin || !sameRemote(origin, data.clone_url)) throw new ProjectError('Destination contains a different repository');
      if (!options.reuseExisting) throw new ExistingCloneError('This repository already exists. Use the existing folder?');
    } else {
      await fs.promises.mkdir(destination); owned = true; ownedIdentity = await fs.promises.lstat(destination);
    }
  } else {
    const stat = await fs.promises.stat(destination).catch(() => null);
    if (!stat?.isDirectory()) throw new ProjectError('Folder not found');
    destination = await fs.promises.realpath(destination);
    checkPath('project', destination);
  }
  try {
    if (owned) await cloneRepository(data.clone_url!, destination, options);
    options.signal?.throwIfAborted();
    const metadata = await inspectProjectGit(destination);
    return createProject({ ...data, repo_path: destination, clone_url: metadata.clone_url || data.clone_url || '',
      host_project_path: data.host_project_path || metadata.host_project_path,
      connection_id: data.connection_id === undefined ? metadata.connection_id : data.connection_id });
  } catch (error) {
    if (owned) {
      const stat = await fs.promises.lstat(destination).catch(() => null);
      if (stat?.isDirectory() && stat.ino === ownedIdentity?.ino && stat.dev === ownedIdentity?.dev && !stat.isSymbolicLink() && path.dirname(destination) === await fs.promises.realpath(path.dirname(destination)))
        await fs.promises.rm(destination, { recursive: true, force: true });
    }
    throw error;
  }
}

export async function inspectProjectGit(root: string) {
  if (typeof root !== 'string' || !path.isAbsolute(root)) throw new ProjectError('Choose an absolute folder path');
  const raw = await originUrl(root);
  const remote = raw ? parseRemoteUrl(raw) : null;
  const matches = remote ? listConnections().filter(connection => {
    try { return new URL(connection.base_url).hostname.toLowerCase() === remote.host; } catch { return false; }
  }) : [];
  return { repository: await isRepository(root), clone_url: raw ? publicRemoteUrl(raw) : '', host_project_path: remote?.projectPath ?? '',
    connection_id: matches.length === 1 ? matches[0].id : null };
}
