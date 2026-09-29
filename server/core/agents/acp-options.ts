import type * as ACP from '@agentclientprotocol/sdk';
import { getDb } from '../../infrastructure/db/schema';

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
  at: number;
}
type Initialized = Pick<ACP.InitializeResponse, 'agentInfo' | 'agentCapabilities'>;

let ready = false;
function db() {
  if (!ready) {
    getDb().exec(`CREATE TABLE IF NOT EXISTS agent_acp_options (
      agent_id TEXT PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE, options TEXT NOT NULL, updated_at INTEGER NOT NULL)`);
    ready = true;
  }
  return getDb();
}

export function getAcpOptions(agentId: string): AcpOptions | null {
  const row = db().prepare('SELECT options FROM agent_acp_options WHERE agent_id=?').get(agentId) as { options: string } | undefined;
  return row ? JSON.parse(row.options) : null;
}

/** Forget what the agent reported, e.g. after its adapter command changed. */
export function clearAcpOptions(agentId: string): void {
  db().prepare('DELETE FROM agent_acp_options WHERE agent_id=?').run(agentId);
}

/** Only call with a brand-new session's response: its current values are the agent's defaults. */
export function saveAcpOptions(agentId: string, response: { configOptions?: ACP.SessionConfigOption[] | null; modes?: ACP.SessionModeState | null; models?: unknown }, init?: Initialized): AcpOptions {
  const options: AcpOptions = { configOptions: response.configOptions ?? null, modes: response.modes ?? null, models: response.models ?? null,
    agent: init?.agentInfo ?? null,
    capabilities: init ? { loadSession: !!init.agentCapabilities?.loadSession, mcpHttp: !!init.agentCapabilities?.mcpCapabilities?.http } : null,
    at: Date.now() };
  db().prepare('INSERT INTO agent_acp_options(agent_id, options, updated_at) VALUES (?,?,?) ON CONFLICT(agent_id) DO UPDATE SET options=excluded.options, updated_at=excluded.updated_at')
    .run(agentId, JSON.stringify(options), options.at);
  return options;
}
