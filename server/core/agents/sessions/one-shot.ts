import { createSession, history, updateSession } from './sessions';
import { closeSession } from './acp-host';
import { runAgentWork, waitForAgentTurn } from '../work';
export interface OneShotAgent { agentId: string; model?: string; effort?: string }
/** A bounded read-only turn, with listeners installed before the adapter starts. */
export async function oneShot(projectId: string, agent: OneShotAgent, prompt: string, title = 'Сообщение коммита'): Promise<string> {
  const session = createSession({ project_id: projectId, agent_id: agent.agentId, model: agent.model ?? '', role: 'committer', policy: 'read-only', title,
    ...(agent.effort ? { metadata: { reasoningEffort: agent.effort } } : {}) });
  const turn = waitForAgentTurn(session.id);
  try {
    await Promise.all([runAgentWork(session.id, [{ type: 'text', text: prompt }]), turn.result]);
    const events = history(session.id);
    if (events.filter(e => e.type === 'turn_end').at(-1)?.payload.stopReason === 'cancelled') throw new Error('Генерация отменена');
    const text = events.filter(e => e.type === 'assistant').map(e => String(e.payload.text ?? '')).join('');
    updateSession(session.id, { status: 'complete', reason: '' });
    return text;
  } catch (error) { updateSession(session.id, { status: 'error', reason: String(error) }); throw error; }
  finally { turn.dispose(); await closeSession(session.id); }
}
