import { analysisToolContext, saveAnalystSection } from '../../../core/preparation/analysis-context';
import type { AgentSession } from '../../../core/agents';
import { defineTools, type ToolEvent } from './types';
import { planTask, planResult } from './context';
const definitions = {
get_analysis: { description: 'Get analysis sections, descriptions and attachment paths. Call before analyzing.', fields: {} },
save_section: {
    description: 'Save an analysis section. Omit slug to create; supply existing slug to update. Defaults to worked, author agent. Source or developer material edits require an explicit developer request and source_requested=true.',
    fields: { title: { type: 'string' }, description: { type: 'string' }, slug: { type: 'string' },
      kind: { type: 'string', enum: ['source', 'worked'] }, source_requested: { type: 'boolean' } },
  }
};

async function handle(name: keyof typeof definitions, session: AgentSession, args: Record<string, unknown>, emit: ToolEvent) {
  const id = session.id;
  const { task, project } = planTask(session);
const section = name === 'save_section' ? saveAnalystSection(task.id, args) : null;
const result = section ? { saved: true, section: { id: section.id, slug: section.slug, title: section.title, kind: section.kind, author: section.author }, link: '[[' + section.slug + ']]' }
          : analysisToolContext(task.id, project.repo_path, task.key);
if (section) emit(name, { summary: 'Раздел анализа сохранён: ' + section.title, link: '[[' + section.slug + ']]' });
return result;
}
export const tools = defineTools(definitions, {
get_analysis: { roles: {"analyst":1}, required: [], validateStrings: [] },
save_section: { roles: {"analyst":2}, required: ["title","description"], validateStrings: [] }
}, handle);
