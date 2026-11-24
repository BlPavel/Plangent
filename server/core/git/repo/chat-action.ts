import type { AgentSession } from '../../agents';
import { getProject } from '../../projects';
import { effectiveGitSettings } from '../../settings';
import { rootForSession } from '../../workspaces';
import { executeGitOperation } from './operation';
import { commit } from './git-write';
import { createBranch, switchBranch, fetchRepository, pull, push, stashChanges, discard, integrateBranch, manageTag } from './operations';

export async function prepareChatGitAction(session: AgentSession, args: Record<string, unknown>) {
  if (getProject(session.project_id)?.kind !== 'project' || !['chat', 'task-chat', 'errand'].includes(session.role) || session.metadata.mr_private || session.metadata.branch_review) throw new Error('Git actions are unavailable for this session');
  const action = args.action;
  const actions = ['commit', 'branch', 'switch', 'fetch', 'pull', 'push', 'stash', 'discard', 'merge', 'rebase', 'tag'];
  if (typeof action !== 'string' || !actions.includes(action)) throw new Error('Invalid Git action');
  const allowedFields: Record<string, string[]> = { commit: ['paths', 'title', 'body'], branch: ['name', 'base'], switch: ['branch'], fetch: [], pull: [], push: [], stash: ['stashAction', 'reference'], discard: ['paths'], merge: ['branch'], rebase: ['branch'], tag: ['tagAction', 'name', 'ref', 'message'] };
  const unexpected = Object.keys(args).filter(key => key !== 'action' && !allowedFields[action].includes(key));
  if (unexpected.length) throw new Error(`Unexpected Git action argument for ${action}: ${unexpected.join(', ')}. Allowed fields: ${['action', ...allowedFields[action]].join(', ')}. Omit all other fields, including empty or null values.`);
  const required = (key: string) => { if (typeof args[key] !== 'string' || !String(args[key]).trim()) throw new Error(`Invalid ${key}`); return String(args[key]); };
  const paths = () => { if (!Array.isArray(args.paths) || !args.paths.length || args.paths.some(p => typeof p !== 'string' || !p)) throw new Error('Invalid paths'); return args.paths as string[]; };
  if (['commit', 'discard'].includes(action)) paths();
  if (action === 'commit') { required('title'); if (args.body !== undefined && typeof args.body !== 'string') throw new Error('Invalid body'); }
  if (action === 'branch') { required('name'); required('base'); }
  if (['switch', 'merge', 'rebase'].includes(action)) required('branch');
  if (action === 'stash' && !['push', 'pop', 'apply', 'drop'].includes(required('stashAction'))) throw new Error('Invalid stash action');
  if (action === 'tag') {
    if (!['create', 'delete', 'push'].includes(required('tagAction'))) throw new Error('Invalid tag action');
    required('name');
    for (const key of ['ref', 'message']) if (args[key] !== undefined && typeof args[key] !== 'string') throw new Error(`Invalid ${key}`);
    if (args.tagAction !== 'create' && (args.ref !== undefined || args.message !== undefined)) throw new Error('ref and message are only for tagAction=create');
  }
  if (args.reference !== undefined && typeof args.reference !== 'string') throw new Error('Invalid stash reference');
  const root = await rootForSession(session);
  return {
    title: `Git: ${JSON.stringify(args)}`,
    execute: async (signal: AbortSignal, onProgress?: (event: { operationId: string; state?: 'started' | 'finished'; output?: string }) => void) => {
      signal.throwIfAborted();
      if (getProject(session.project_id)?.kind !== 'project' || await rootForSession(session) !== root) throw new Error('Git workspace changed while awaiting approval');
      return executeGitOperation({ projectId: session.project_id, root, signal, onProgress }, async (repo, options) => {
      switch (action) {
        case 'commit': return commit(repo, { title: required('title'), body: typeof args.body === 'string' ? args.body : '', includeDescription: !!args.body }, () => effectiveGitSettings(session.project_id).values, options, false, paths());
        case 'branch': return createBranch(repo, required('name'), required('base'), options);
        case 'switch': return switchBranch(repo, required('branch'), options);
        case 'fetch': return fetchRepository(repo, options);
        case 'pull': return pull(repo, options);
        case 'push': return push(repo, options);
        case 'stash': return stashChanges(repo, required('stashAction') as 'push' | 'pop' | 'apply' | 'drop', args.reference as string | undefined, options);
        case 'discard': return discard(repo, paths(), options);
        case 'merge': case 'rebase': return integrateBranch(repo, action, required('branch'), options);
        case 'tag': return manageTag(repo, required('tagAction') as 'create' | 'delete' | 'push', required('name'), { ref: args.ref as string | undefined, message: args.message as string | undefined }, options);
        default: throw new Error('Invalid Git action');
      }
      });
    },
  };
}
