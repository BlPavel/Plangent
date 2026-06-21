import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../db/schema';
import { LibraryItem, LibraryItemType, LibraryScope } from '../models/types';

function parse(row: Record<string, unknown>): LibraryItem {
  return {
    ...(row as Omit<LibraryItem, 'frontmatter' | 'agent_filter' | 'enabled'>),
    frontmatter: JSON.parse(row.frontmatter as string || '{}'),
    agent_filter: JSON.parse(row.agent_filter as string || '[]'),
    enabled: Boolean(row.enabled),
  };
}

export function listLibraryItems(filters: {
  type?: LibraryItemType;
  scope?: LibraryScope;
  projectId?: string;
  enabledOnly?: boolean;
} = {}): LibraryItem[] {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters.type) { conditions.push('type = ?'); params.push(filters.type); }
  if (filters.scope) { conditions.push('scope = ?'); params.push(filters.scope); }
  if (filters.projectId !== undefined) {
    if (filters.projectId) { conditions.push('project_id = ?'); params.push(filters.projectId); }
    else { conditions.push('project_id IS NULL'); }
  }
  if (filters.enabledOnly) { conditions.push('enabled = 1'); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = getDb().prepare(`SELECT * FROM library_items ${where} ORDER BY created_at ASC`).all(...params) as Record<string, unknown>[];
  return rows.map(parse);
}

export function getLibraryItem(id: string): LibraryItem | null {
  const row = getDb().prepare('SELECT * FROM library_items WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return row ? parse(row) : null;
}

export function getLibraryItemBySlug(type: LibraryItemType, slug: string, scope: LibraryScope, projectId: string | null): LibraryItem | null {
  const row = projectId
    ? getDb().prepare('SELECT * FROM library_items WHERE type=? AND slug=? AND scope=? AND project_id=?').get(type, slug, scope, projectId)
    : getDb().prepare('SELECT * FROM library_items WHERE type=? AND slug=? AND scope=? AND project_id IS NULL').get(type, slug, scope);
  return row ? parse(row as Record<string, unknown>) : null;
}

export function createLibraryItem(data: {
  type: LibraryItemType;
  slug: string;
  title: string;
  description?: string;
  scope: LibraryScope;
  project_id?: string | null;
  frontmatter?: Record<string, unknown>;
  agent_filter?: string[];
  enabled?: boolean;
}): LibraryItem {
  const id = uuidv4();
  getDb().prepare(`
    INSERT INTO library_items (id, type, slug, title, description, scope, project_id, frontmatter, agent_filter, enabled)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    data.type,
    data.slug,
    data.title,
    data.description ?? '',
    data.scope,
    data.project_id ?? null,
    JSON.stringify(data.frontmatter ?? {}),
    JSON.stringify(data.agent_filter ?? []),
    data.enabled !== false ? 1 : 0,
  );
  return getLibraryItem(id)!;
}

export function updateLibraryItem(id: string, data: Partial<Omit<LibraryItem, 'id' | 'created_at'>>): LibraryItem | null {
  const current = getLibraryItem(id);
  if (!current) return null;

  const u = { ...current, ...data };
  getDb().prepare(`
    UPDATE library_items
    SET type=?, slug=?, title=?, description=?, scope=?, project_id=?, frontmatter=?, agent_filter=?, enabled=?, updated_at=datetime('now')
    WHERE id=?
  `).run(
    u.type, u.slug, u.title, u.description, u.scope,
    u.project_id ?? null,
    JSON.stringify(u.frontmatter),
    JSON.stringify(u.agent_filter),
    u.enabled ? 1 : 0,
    id,
  );
  return getLibraryItem(id);
}

export function deleteLibraryItem(id: string): boolean {
  return getDb().prepare('DELETE FROM library_items WHERE id = ?').run(id).changes > 0;
}

export function setLibraryOverride(itemId: string, agentType: string, filePath: string): void {
  getDb().prepare(`
    INSERT OR REPLACE INTO library_overrides (item_id, agent_type, file_path) VALUES (?, ?, ?)
  `).run(itemId, agentType, filePath);
}

export function getLibraryOverride(itemId: string, agentType: string): string | null {
  const row = getDb().prepare('SELECT file_path FROM library_overrides WHERE item_id=? AND agent_type=?').get(itemId, agentType) as { file_path: string } | undefined;
  return row?.file_path ?? null;
}

export function deleteLibraryOverride(itemId: string, agentType: string): void {
  getDb().prepare('DELETE FROM library_overrides WHERE item_id=? AND agent_type=?').run(itemId, agentType);
}
