import type Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { DATA_DIR } from '../schema';
import { slugify } from './slugify';
export function migrateOldSkills(db: Database.Database): void {
  const alreadyMigrated = db.prepare(`
    SELECT COUNT(*) as cnt FROM library_items
    WHERE slug LIKE 'migrated-%' AND scope = 'project'
  `).get() as { cnt: number };
  if (alreadyMigrated.cnt > 0) return;

  const projectsDir = path.join(process.cwd(), 'data', 'skills', 'projects');
  if (fs.existsSync(projectsDir)) {
    const { v4: uuidv4 } = require('uuid');
    for (const file of fs.readdirSync(projectsDir)) {
      if (!file.endsWith('.md')) continue;
      const projectId = file.replace('.md', '');
      const content = fs.readFileSync(path.join(projectsDir, file), 'utf-8');
      if (!content.trim()) continue;

      const slug = `migrated-${projectId}`;
      const id = uuidv4();
      db.prepare(`
        INSERT OR IGNORE INTO library_items (id, type, slug, title, description, scope, project_id, frontmatter, agent_filter, enabled)
        VALUES (?, 'skill', ?, 'Инструкции проекта (мигрировано)', 'Мигрировано из projects/', 'project', ?, '{}', '[]', 1)
      `).run(id, slug, projectId);

      const libDir = path.join(process.cwd(), 'data', 'library', 'skills', slug);
      fs.mkdirSync(libDir, { recursive: true });
      fs.writeFileSync(path.join(libDir, 'SKILL.md'), content);
    }
  }
}

