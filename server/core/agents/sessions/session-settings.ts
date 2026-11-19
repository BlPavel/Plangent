import type { Agent } from '../../../models';
import { presetForAgentId } from '../catalog/presets';
import { enforceAgentProxy } from './env';

/** Session-only settings forwarded by claude-agent-acp to the Claude SDK. */
export function agentSessionSettings(agent: Pick<Agent, 'id' | 'command' | 'acp_command' | 'acp_args'> & { use_proxy?: boolean }, env?: Record<string, string | undefined>) {
  const claude = presetForAgentId[agent.id] === 'claude'
    || /(?:^|[/\\])claude(?:\.exe)?$/i.test(agent.command)
    || /claude-agent-acp|claude-code-acp/.test([agent.acp_command, ...(agent.acp_args ?? [])].join(' '));
  return claude ? { _meta: { claudeCode: { options: {
    settings: { attribution: { commit: '', pr: '', sessionUrl: false }, includeCoAuthoredBy: false,
      ...(agent.use_proxy && env?.HTTPS_PROXY ? { env: enforceAgentProxy({}, env.HTTPS_PROXY) } : {}) },
    allowDangerouslySkipPermissions: false,
  } } } } : {};
}
