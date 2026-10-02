import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { DATA_DIR, getDb } from '../../infrastructure/db/schema';
import { checkedFile } from '../docs-sources/sync';
import { validateConfig } from '../docs-sources/config';
import { sourceFolder, isDocsSyncRunning } from '../docs-sources';
import { requireConnection } from '../integrations';
import { DocsSelection, SourceType } from '../../models/integrations';
import { slugify } from '../shared/slugify';
import { Project, ProjectConfig, ProjectKind } from '../../models';

function parse(row: Record<string, unknown>): Project {
  const project: Project = {
    ...(row as Omit<Project, 'config' | 'hide_from_git'>),
    config: JSON.parse(row.config as string || '{}'),
    hide_from_git: Boolean(row.hide_from_git),
    docs_config: JSON.parse(row.docs_config as string || '{}'),
    docs_selection: JSON.parse(row.docs_selection as string || '[]'),
    sync_stats: JSON.parse(row.sync_stats as string || '{}'),
  };
  if (project.kind === 'source') project.targets = sourceTargets(project.id);
  return project;
}

function sourceTargets(id: string): string[] {
  return (getDb().prepare('SELECT target_id FROM source_targets WHERE source_id=?').all(id) as { target_id: string }[]).map(r => r.target_id);
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
  const resolved = path.resolve(repoPath).toLowerCase();
  const twin = listProjects().find(p => p.id !== exceptId && p.kind !== 'group' && path.resolve(p.repo_path).toLowerCase() === resolved);
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
    ...members.map(p => `- **${p.name}** (\`@${p.key}\`): \`${p.repo_path}\`${p.description ? ` — ${p.description}` : ''}`),
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
  targets?: string[];
  source_type?: SourceType;
  connection_id?: string | null;
  docs_config?: Record<string, unknown>;
  docs_selection?: DocsSelection[];
}

function setSourceTargets(id: string, targets: string[]): void {
  const db = getDb();
  db.transaction(() => {
    db.prepare('DELETE FROM source_targets WHERE source_id=?').run(id);
    for (const target of new Set(targets)) {
      if (getProject(target)) db.prepare('INSERT INTO source_targets (source_id, target_id) VALUES (?, ?)').run(id, target);
    }
  })();
}


function docsSettings(data: Partial<ProjectInput>, current?: Project) {
  const type = data.source_type ?? current?.source_type ?? 'folder';
  if (!['folder', 'docs'].includes(type)) throw new ProjectError('Invalid source type');
  if (current && type !== current.source_type) throw new ProjectError('Source type cannot be changed');
  if (type !== 'docs') return { type, connection: null, config: {}, selection: [] };
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
  const kind = data.kind ?? 'project';
  if (!['project', 'group', 'source'].includes(kind)) throw new ProjectError('Invalid project kind');
  const settings = docsSettings(data);
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
  if (settings.type === 'docs') fs.mkdirSync(repoPath, { recursive: true });
  if (kind === 'source') setSourceTargets(id, data.targets ?? []);
  if (kind === 'group') writeGroupReadme(id);
  if (data.group_id) writeGroupReadme(data.group_id);
  return getProject(id)!;
}

export function updateProject(id: string, data: Partial<ProjectInput>): Project | null {
  const current = getProject(id);
  if (!current) return null;
  if (isDocsSyncRunning(id)) throw new ProjectError('Cancel sync before changing the source');
  const settings = docsSettings(data, current);
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
  if (current.kind === 'source' && data.targets) setSourceTargets(id, data.targets);
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
