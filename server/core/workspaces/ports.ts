import net from 'node:net';
import type { Workspace } from '../../models';
import { effectiveGitSettings, parsePortSetting } from '../settings';
import { activePortSlots } from './store';

/** Slot N moves every configured port by N × 10: PORT=3001 becomes 3011, 3021, … */
export const PORT_STEP = 10;
const MAX_SLOTS = 100;

function shiftedPorts(entries: string[], slot: number): { name: string; port: number }[] {
  return entries.map(parsePortSetting).map(({ name, port }) => ({ name, port: port + slot * PORT_STEP }));
}

function portFree(port: number, host?: string): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.once('error', (error: NodeJS.ErrnoException) => resolve(error.code === 'EADDRNOTAVAIL' || error.code === 'EAFNOSUPPORT'));
    server.listen({ port, host, exclusive: true }, () => server.close(() => resolve(true)));
  });
}

async function slotFree(entries: string[], slot: number): Promise<boolean> {
  for (const { port } of shiftedPorts(entries, slot)) {
    if (port > 65535) return false;
    // Dev servers usually listen on localhost only, which a check on all interfaces does not always notice on Windows.
    if (!await portFree(port) || !await portFree(port, '127.0.0.1')) return false;
  }
  return true;
}

/**
 * The lowest slot no active workspace of the project uses and whose ports nothing listens on.
 * A recreated workspace keeps its slot: its own app may still be running on those ports.
 */
export async function allocatePortSlot(projectId: string, preferred?: number): Promise<number> {
  const taken = new Set(activePortSlots(projectId));
  if (preferred && !taken.has(preferred)) return preferred;
  const entries = effectiveGitSettings(projectId).values.workspace_ports;
  for (let slot = 1; slot <= MAX_SLOTS; slot++) {
    if (!taken.has(slot) && await slotFree(entries, slot)) return slot;
  }
  let slot = 1;
  while (taken.has(slot)) slot++;
  return slot;
}

/** Environment for everything that runs in the workspace: terminals, the setup command and agents. */
export function workspaceEnv(workspace: Pick<Workspace, 'project_id' | 'port_slot'>): Record<string, string> {
  const env: Record<string, string> = { PLANGENT_PORT_SLOT: String(workspace.port_slot) };
  for (const { name, port } of shiftedPorts(effectiveGitSettings(workspace.project_id).values.workspace_ports, workspace.port_slot)) env[name] = String(port);
  return env;
}
