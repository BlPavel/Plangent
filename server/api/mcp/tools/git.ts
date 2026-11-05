import { authorizeGitAction, captureGitTurn, type AgentSession } from '../../../core/agents';
import { prepareChatGitAction } from '../../../core/git/repo/chat-action';
import { defineTools } from './types';

const definitions = {
  git_action: {
    description: 'Request a Git action chosen by the developer. Actions may require their approval. Never use shell Git commands to change the repository.',
    fields: {
      action: { type: 'string', enum: ['commit', 'branch', 'switch', 'fetch', 'pull', 'push', 'stash', 'discard', 'merge', 'rebase'] },
      paths: { type: 'array', items: { type: 'string' } }, title: { type: 'string' }, body: { type: 'string' },
      name: { type: 'string' }, base: { type: 'string' }, branch: { type: 'string' },
      stashAction: { type: 'string', enum: ['push', 'pop', 'apply', 'drop'] }, reference: { type: 'string' },
    },
  },
};

export const tools = defineTools(definitions, {
  git_action: { roles: { chat: 0, 'task-chat': 5, errand: 6 }, required: ['action'], validateStrings: ['action'] },
}, async (_name, session: AgentSession, args, emit) => {
  const expectedSignal = captureGitTurn(session.id);
  const prepared = await prepareChatGitAction(session, args);
  const signal = await authorizeGitAction(session.id, prepared.title, prepared.alwaysAsk, expectedSignal);
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
