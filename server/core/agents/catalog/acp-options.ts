import type * as ACP from '../../../infrastructure/acp/types';
import { readOptions, writeOptions } from '../../../infrastructure/db/repositories/agents/options';
export { clearAcpOptions } from '../../../infrastructure/db/repositories/agents/options';

/**
 * What an ACP agent offers for a fresh session — models, modes, reasoning levels — as it reported
 * them itself. Lets the UI list them before a chat exists instead of relying on hand-typed lists.
 */
export interface AcpOptions {
  configOptions?: ACP.SessionConfigOption[] | null;
  modes?: ACP.SessionModeState | null;
  models?: unknown;
  /** From `initialize`: who answered and what it can do. */
  agent?: { name?: string; title?: string | null; version?: string } | null;
  capabilities?: { loadSession: boolean; mcpHttp: boolean } | null;
  /** The start command that answered; a different one (a preset moved to a new adapter version) asks again. */
  launch?: string;
  at: number;
}
type Initialized = Pick<ACP.InitializeResponse, 'agentInfo' | 'agentCapabilities'>;

export function getAcpOptions(agentId: string): AcpOptions | null { const value = readOptions(agentId); return value ? JSON.parse(value) : null; }
/** Only call with a brand-new session's response: its current values are the agent's defaults. */
export function saveAcpOptions(agentId: string, response: { configOptions?: ACP.SessionConfigOption[] | null; modes?: ACP.SessionModeState | null; models?: unknown }, launch: string, init?: Initialized): AcpOptions {
  const options: AcpOptions = { configOptions: response.configOptions ?? null, modes: response.modes ?? null, models: response.models ?? null,
    agent: init?.agentInfo ?? null, launch,
    capabilities: init ? { loadSession: !!init.agentCapabilities?.loadSession, mcpHttp: !!init.agentCapabilities?.mcpCapabilities?.http } : null,
    at: Date.now() };
  writeOptions(agentId, JSON.stringify(options), options.at);
  return options;
}
