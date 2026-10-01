import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../../infrastructure/db/schema';
import { LibraryItem, LibraryItemType, LibraryScope, Project } from '../../models';

function targetsOf(itemId: string): { targets: string[]; own_only: string[] } {
  const rows = getDb().prepare('SELECT target_id, own_only FROM library_item_targets WHERE item_id=?').all(itemId) as { target_id: string; own_only: number }[];
  return { targets: rows.map(r => r.target_id), own_only: rows.filter(r => r.own_only).map(r => r.target_id) };
}

function parse(row: Record<string, unknown>): LibraryItem {
  return {
    ...(row as Omit<LibraryItem, 'frontmatter' | 'agent_filter' | 'enabled' | 'targets' | 'own_only' | 'excluded'>),
    frontmatter: JSON.parse(row.frontmatter as string || '{}'),
    agent_filter: JSON.parse(row.agent_filter as string || '[]'),
    enabled: Boolean(row.enabled),
    ...targetsOf(row.id as string),
    excluded: (getDb().prepare('SELECT project_id FROM library_item_exclusions WHERE item_id=?').all(row.id) as { project_id: string }[]).map(r => r.project_id),
    detached_from: (row.detached_from as string | null) ?? null,
  };
}

export function listLibraryItems(filters: {
  type?: LibraryItemType;
  scope?: LibraryScope;
  // Items targeted at exactly this group/project (not inherited ones); '' means global items.
  projectId?: string;
  enabledOnly?: boolean;
} = {}): LibraryItem[] {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters.type) { conditions.push('type = ?'); params.push(filters.type); }
  if (filters.scope) { conditions.push('scope = ?'); params.push(filters.scope); }
  if (filters.projectId !== undefined) {
    if (filters.projectId) { conditions.push(`scope = 'project' AND id IN (SELECT item_id FROM library_item_targets WHERE target_id = ?)`); params.push(filters.projectId); }
    else { conditions.push(`scope = 'global'`); }
  }
  if (filters.enabledOnly) { conditions.push('enabled = 1'); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = getDb().prepare(`SELECT * FROM library_items ${where} ORDER BY created_at ASC`).all(...params) as Record<string, unknown>[];
  return rows.map(parse);
}

/** How an item reaches a project: everywhere, through the project's group, or directly. */
export type LibraryOrigin = 'global' | 'group' | 'direct';

export function libraryOrigin(item: LibraryItem, project: Project): LibraryOrigin | null {
  if (item.scope === 'global') return 'global';
  if (item.excluded.includes(project.id)) return null;
  if (item.targets.includes(project.id)) return 'direct';
  if (project.group_id && item.targets.includes(project.group_id) && !item.own_only.includes(project.group_id)) return 'group';
  return null;
}

/** Items that apply to a project or group, with where each comes from. */
export function libraryItemsFor(project: Project, type?: LibraryItemType): (LibraryItem & { origin: LibraryOrigin })[] {
  return listLibraryItems({ type }).flatMap(item => {
    const origin = libraryOrigin(item, project);
    return origin ? [{ ...item, origin }] : [];
  });
}

export function getLibraryItem(id: string): LibraryItem | null {
  const row = getDb().prepare('SELECT * FROM library_items WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return row ? parse(row) : null;
}

function setTargets(id: string, targets: string[], ownOnly: string[] = []): void {
  const db = getDb();
  db.prepare('DELETE FROM library_item_targets WHERE item_id=?').run(id);
  for (const target of new Set(targets)) {
    if (db.prepare('SELECT 1 FROM projects WHERE id=?').get(target)) db.prepare('INSERT INTO library_item_targets (item_id, target_id, own_only) VALUES (?, ?, ?)').run(id, target, ownOnly.includes(target) ? 1 : 0);
  }
}

export function createLibraryItem(data: {
  type: LibraryItemType;
  slug: string;
  title: string;
  description?: string;
  scope: LibraryScope;
  targets?: string[];
  own_only?: string[];
  detached_from?: string | null;
  frontmatter?: Record<string, unknown>;
  agent_filter?: string[];
  enabled?: boolean;
}): LibraryItem {
  const id = uuidv4();
  getDb().transaction(() => {
    getDb().prepare(`
      INSERT INTO library_items (id, type, slug, title, description, scope, project_id, frontmatter, agent_filter, enabled, detached_from)
      VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)
    `).run(
      id,
      data.type,
      data.slug,
      data.title,
      data.description ?? '',
      data.scope,
      JSON.stringify(data.frontmatter ?? {}),
      JSON.stringify(data.agent_filter ?? []),
      data.enabled !== false ? 1 : 0,
      data.detached_from ?? null,
    );
    setTargets(id, data.scope === 'project' ? data.targets ?? [] : [], data.own_only);
  })();
  return getLibraryItem(id)!;
}

export function updateLibraryItem(id: string, data: Partial<Omit<LibraryItem, 'id' | 'created_at'>>): LibraryItem | null {
  const current = getLibraryItem(id);
  if (!current) return null;

  const u = { ...current, ...data };
  getDb().transaction(() => {
    getDb().prepare(`
      UPDATE library_items
      SET type=?, slug=?, title=?, description=?, scope=?, frontmatter=?, agent_filter=?, enabled=?, updated_at=datetime('now')
      WHERE id=?
    `).run(
      u.type, u.slug, u.title, u.description, u.scope,
      JSON.stringify(u.frontmatter),
      JSON.stringify(u.agent_filter),
      u.enabled ? 1 : 0,
      id,
    );
    setTargets(id, u.scope === 'project' ? u.targets : [], u.own_only);
  })();
  return getLibraryItem(id);
}

/** Takes a project out of a shared item (or puts it back). */
export function setExcluded(itemId: string, projectId: string, excluded: boolean): void {
  const db = getDb();
  if (excluded) db.prepare('INSERT OR IGNORE INTO library_item_exclusions (item_id, project_id) VALUES (?, ?)').run(itemId, projectId);
  else db.prepare('DELETE FROM library_item_exclusions WHERE item_id=? AND project_id=?').run(itemId, projectId);
}

export function deleteLibraryItem(id: string): boolean {
  return getDb().prepare('DELETE FROM library_items WHERE id = ?').run(id).changes > 0;
}

export function setLibraryOverride(itemId: string, agentType: string, filePath: string): void {
  getDb().prepare(`
    INSERT OR REPLACE INTO library_overrides (item_id, agent_type, file_path) VALUES (?, ?, ?)
  `).run(itemId, agentType, filePath);
}

export function deleteLibraryOverride(itemId: string, agentType: string): void {
  getDb().prepare('DELETE FROM library_overrides WHERE item_id=? AND agent_type=?').run(itemId, agentType);
}
