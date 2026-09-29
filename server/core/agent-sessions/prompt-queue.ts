import { randomUUID } from 'crypto';
import { getDb } from '../../infrastructure/db/schema';
export interface QueuedPrompt { id: string; session_id: string; content: string; }
export function queuedPrompts(id: string): QueuedPrompt[] {
  return getDb().prepare('SELECT * FROM agent_prompt_queue WHERE session_id=? ORDER BY rowid').all(id) as QueuedPrompt[];
}
export function enqueue(id: string, content: string): QueuedPrompt {
  const prompt = { id: randomUUID(), session_id: id, content };
  getDb().prepare('INSERT INTO agent_prompt_queue(id,session_id,content) VALUES (?,?,?)').run(prompt.id, id, content);
  return prompt;
}
export function editQueued(id: string, promptId: string, content?: string): void {
  if (content !== undefined) getDb().prepare('UPDATE agent_prompt_queue SET content=? WHERE id=? AND session_id=?').run(content, promptId, id);
  else getDb().prepare('DELETE FROM agent_prompt_queue WHERE id=? AND session_id=?').run(promptId, id);
}
