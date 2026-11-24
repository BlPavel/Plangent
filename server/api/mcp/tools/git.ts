import { authorizeGitAction, captureGitTurn, type AgentSession } from '../../../core/agents';
import { prepareChatGitAction } from '../../../core/git/repo/chat-action';
import { defineTools } from './types';

const definitions = {
  git_action: {
    description: 'Request a Git action chosen by the developer. Actions may require their approval. Never use shell Git commands to change the repository. '
      + 'Send only fields belonging to the selected action; omit all other fields, including empty or null values. '
      + 'Required fields by action: commit: paths, title (optional body); branch: name, base; switch, merge, rebase: branch; '
      + 'fetch, pull, push: no fields besides action; stash: stashAction (optional reference); discard: paths; '
      + 'tag: tagAction (create, delete, push), name (optional ref and message, only for create; a message makes an annotated tag; delete removes the local tag only). '
      + 'Example rebase: {"action":"rebase","branch":"origin/main"}.',
    fields: {
      action: { type: 'string', enum: ['commit', 'branch', 'switch', 'fetch', 'pull', 'push', 'stash', 'discard', 'merge', 'rebase', 'tag'] },
      paths: { type: 'array', items: { type: 'string' } }, title: { type: 'string' }, body: { type: 'string' },
      name: { type: 'string', description: 'New branch name for action=branch; tag name for action=tag.' },
      tagAction: { type: 'string', enum: ['create', 'delete', 'push'], description: 'Only for action=tag.' },
      ref: { type: 'string', description: 'Commit or ref to tag, default HEAD. Only for action=tag, tagAction=create.' },
      message: { type: 'string', description: 'Annotation message. Only for action=tag, tagAction=create.' },
      base: { type: 'string', description: 'Starting ref for the new branch. Only for action=branch.' },
      branch: { type: 'string', description: 'Target ref. Required only for switch, merge, rebase; for rebase this is the upstream ref.' },
      stashAction: { type: 'string', enum: ['push', 'pop', 'apply', 'drop'] }, reference: { type: 'string' },
    },
  },
};

export const tools = defineTools(definitions, {
  git_action: { roles: { chat: 0, 'task-chat': 5, errand: 6 }, required: ['action'], validateStrings: ['action'] },
}, async (_name, session: AgentSession, args, emit) => {
  const expectedSignal = captureGitTurn(session.id);
  const prepared = await prepareChatGitAction(session, args);
  const signal = await authorizeGitAction(session.id, prepared.title, expectedSignal);
  if (!signal) return { cancelled: true };
  let outputSize = 0;
  return prepared.execute(signal, event => {
    if (event.output) {
      const output = event.output.slice(0, Math.max(0, 20000 - outputSize));
      outputSize += output.length;
      if (output) emit('git_action_progress', { operationId: event.operationId, output });
    } else emit('git_action_progress', event);
  });
});
