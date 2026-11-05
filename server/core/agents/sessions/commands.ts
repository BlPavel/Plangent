import type { ContentBlock } from '../../../infrastructure/acp/types';
import type { AgentSession } from './types';
import { interviewFocus } from '../../library';

/** Kept separate from ACP commands, including a colliding agent /interview. */
export function sessionCommands(session: AgentSession) {
  try { interviewFocus(session); }
  catch { return []; }
  return [{ name: 'interview', description: 'Уточнить решения небольшими раундами вопросов', source: 'plangent' as const }];
}

/** Transform only outbound content. Persist and queue the original developer message. */
export function commandPrompt(session: AgentSession, content: ContentBlock[]): ContentBlock[] {
  if (!sessionCommands(session).length) return content;
  const firstText = content.findIndex(c => c.type === 'text');
  return content.map((block, index) => {
    if (index !== firstText || block.type !== 'text') return block;
    // Explicit namespace bypasses a colliding built-in Plangent command.
    if (/^\/agent:interview(?=\s|$)/.test(block.text))
      return { ...block, text: block.text.replace(/^\/agent:interview/, '/interview') };
    const match = /^\/interview(?=\s|$)\s*/.exec(block.text);
    if (!match) return block;
    const wish = block.text.slice(match[0].length);
    return { ...block, text: 'The developer enabled Plangent interview mode. Call get_interview_guide and follow it.' + (wish ? '\nDeveloper wish: ' + wish : '') };
  });
}
