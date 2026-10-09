import { createSession, history, updateSession } from './sessions';
import { sendPrompt, closeSession, sessionSignals } from './acp-host';
/** A bounded read-only turn, with listeners installed before the adapter starts. */
export async function oneShot(projectId: string, agentId: string, prompt: string): Promise<string> {
  const session = createSession({ project_id: projectId, agent_id: agentId, role: 'chat', policy: 'read-only', title: 'Сообщение коммита' });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let done!: (id: string) => void, failed!: (id: string, reason: string) => void;
  try {
    const result = new Promise<string>((resolve, reject) => {
      done = id => {
        if (id !== session.id) return;
        const events = history(id);
        if (events.filter(e => e.type === 'turn_end').at(-1)?.payload.stopReason === 'cancelled') return reject(new Error('Генерация отменена'));
        resolve(events.filter(e => e.type === 'assistant').map(e => String(e.payload.text ?? '')).join(''));
      };
      failed = (id, reason) => { if (id === session.id) reject(new Error(reason)); };
      sessionSignals.on('turn_end', done); sessionSignals.on('error-state', failed);
      timer = setTimeout(() => reject(new Error('Генерация сообщения превысила 120 секунд')), 120000);
    });
    void sendPrompt(session.id, [{ type: 'text', text: prompt }]).catch(error => failed(session.id, String(error)));
    const text = await result;
    updateSession(session.id, { status: 'complete', reason: '' });
    return text;
  } catch (error) { updateSession(session.id, { status: 'error', reason: String(error) }); throw error; }
  finally { clearTimeout(timer); sessionSignals.off('turn_end', done); sessionSignals.off('error-state', failed); await closeSession(session.id); }
}
