import type { Agent } from '../../models';
import { presetForAgentId } from '../agents/presets';

/** Session-only settings forwarded by claude-agent-acp to the Claude SDK. */
export function agentSessionSettings(agent: Pick<Agent, 'id' | 'command' | 'acp_command' | 'acp_args'>) {
  const claude = presetForAgentId[agent.id] === 'claude'
    || /(?:^|[/\\])claude(?:\.exe)?$/i.test(agent.command)
    || /claude-agent-acp|claude-code-acp/.test([agent.acp_command, ...(agent.acp_args ?? [])].join(' '));
  return claude ? { _meta: { claudeCode: { options: {
    settings: { attribution: { commit: '', pr: '', sessionUrl: false }, includeCoAuthoredBy: false },
    allowDangerouslySkipPermissions: false,
  } } } } : {};
}
