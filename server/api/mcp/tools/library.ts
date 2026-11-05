import { libraryToolContext, libraryToolItem, proposeLibraryChange, type ProposalInput } from '../../../core/library/proposals';
import type { AgentSession } from '../../../core/agents';
import { defineTools, type ToolEvent } from './types';
const definitions = {
get_library: { description: 'Get the project library catalog, instruction authoring guide and available levels. Call first.', fields: {} },
get_library_item: { description: 'Read an available library item, including content.', fields: { id: { type: 'string' } } },
propose_library_change: {
    description: 'Save a library proposal for developer review. Preserve type and slug on update; supply item_id. Availability defaults to project for new items and group copies.',
    fields: { proposal: { type: 'object', additionalProperties: false,
      required: ['action', 'type', 'slug', 'title', 'content', 'explanation'],
      properties: {
        action: { type: 'string', enum: ['create', 'update'] }, type: { type: 'string', enum: ['skill', 'main', 'command', 'review-skill', 'plan-review-skill', 'architecture-review-skill', 'qa-review-skill'] },
        slug: { type: 'string' }, title: { type: 'string' }, description: { type: 'string' }, frontmatter: { type: 'object' },
        content: { type: 'string' }, explanation: { type: 'string' }, item_id: { type: 'string' },
        scope: { type: 'string', enum: ['global', 'project'] }, targets: { type: 'array', items: { type: 'string' } },
        own_only: { type: 'array', items: { type: 'string' } },
      },
    } },
  }
};

async function handle(name: keyof typeof definitions, session: AgentSession, args: Record<string, unknown>, emit: ToolEvent) {
  const id = session.id;
  if (name === 'propose_library_change' && (!args.proposal || typeof args.proposal !== 'object' || Array.isArray(args.proposal))) throw new Error('Invalid proposal');
const result = name === 'get_library' ? libraryToolContext(session.project_id)
          : name === 'get_library_item' ? libraryToolItem(session.project_id, String(args.id))
          : proposeLibraryChange(id, args.proposal as unknown as ProposalInput);
if (name === 'propose_library_change') {
          const proposal = result as ReturnType<typeof proposeLibraryChange>;
          emit(name, { summary: proposal.explanation, proposal_id: proposal.id });
        }
return result;
}
export const tools = defineTools(definitions, {
get_library: { roles: {"librarian":0}, required: [], validateStrings: [] },
get_library_item: { roles: {"librarian":1}, required: ["id"], validateStrings: ["id"] },
propose_library_change: { roles: {"librarian":2}, required: ["proposal"], validateStrings: [] }
}, handle);
