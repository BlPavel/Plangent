import type Database from 'better-sqlite3';
type AgentPreset = { name: string; command: string; update_command: string; layout_profile: unknown };
import { getDb } from '../../schema';
// Built-in agents, created on first start from their presets (core/agents/presets).
const SEEDED: [string, string][] = [['agent-claude', 'claude'], ['agent-codex', 'codex']];

function seedDefaultAgents(db: Database.Database, presets: Record<string, AgentPreset>): void {
  const existing = db.prepare('SELECT COUNT(*) as cnt FROM agents').get() as { cnt: number };
  if (existing.cnt > 0) return;
  const insert = db.prepare(`INSERT INTO agents (id, name, command, update_command, layout_profile) VALUES (?, ?, ?, ?, ?)`);
  for (const [id, key] of SEEDED) {
    const p = presets[key];
    insert.run(id, p.name, p.command, p.update_command, JSON.stringify(p.layout_profile));
  }
}

export function initializeAgentPresets(presets: Record<string, AgentPreset>, db: Database.Database = getDb()): void {
  seedDefaultAgents(db, presets);
  // Built-in agents from installs that predate layout_profile / update_command.
  for (const [id, key] of SEEDED) {
    const p = presets[key];
    db.prepare(`UPDATE agents SET layout_profile = ? WHERE id = ? AND layout_profile IS NULL`).run(JSON.stringify(p.layout_profile), id);
    db.prepare(`UPDATE agents SET update_command = ? WHERE id = ? AND trim(update_command) = ''`).run(p.update_command, id);
  }
}
