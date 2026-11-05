import { materialToolContext, submitMaterial } from '../../../core/preparation/materials/author';
import type { AgentSession } from '../../../core/agents';
import { defineTools, type ToolEvent } from './types';
const definitions = {
get_material: { description: 'Get the task, analysis, your document (current text and version), how to write it and the format rules. Call it before writing or changing the document, and again after a rejected save.', fields: {} },
submit_material: {
    description: 'Save the whole document (markdown) of your section. Call again with the full text after every change. The save is rejected if the developer changed the document after get_material; then read it again and carry over your edits. Does not mark the section ready: only the developer does that.',
    fields: { content: { type: 'string' } },
  }
};

async function handle(name: keyof typeof definitions, session: AgentSession, args: Record<string, unknown>, emit: ToolEvent) {
  const id = session.id;
  const result = name === 'get_material' ? materialToolContext(session) : submitMaterial(session, args);
if (name === 'submit_material') emit(name, { summary: 'Документ сохранён, версия ' + (result as { version: number }).version });
return result;
}
export const tools = defineTools(definitions, {
get_material: { roles: {"material-author":1}, required: [], validateStrings: [] },
submit_material: { roles: {"material-author":2}, required: ["content"], validateStrings: ["content"] }
}, handle);
