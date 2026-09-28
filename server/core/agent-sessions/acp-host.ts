import type * as ACP from '@agentclientprotocol/sdk';
import { Readable, Writable } from 'stream';
import spawn from 'cross-spawn';
import { randomUUID } from 'crypto';
import { EventEmitter } from 'events';
import { getAgent } from '../agents';
import { getProject } from '../projects';
import { broadcast } from '../shared/events';
import { addEvent, getSession, updateSession } from './sessions';
import { enqueue, queuedPrompts, editQueued } from './prompt-queue';
import { permissionDecision } from './permissions';
import type { AgentSession } from './types';

// Preserve native import when the Electron server is compiled as CommonJS.
const loadSdk = new Function('return import("@agentclientprotocol/sdk")') as () => Promise<typeof ACP>;
interface LiveSession {
  connection: ACP.ClientConnection;
  process: ReturnType<typeof spawn>;
  busy: boolean;
  stopping: boolean;
  loading: boolean;
  cancelled: boolean;
  text: string;
  textType: string;
  permissions: Map<string, { request: ACP.RequestPermissionRequest; resolve: (response: ACP.RequestPermissionResponse) => void }>;
}
const live = new Map<string, LiveSession>();
const starting = new Map<string, Promise<LiveSession>>();
export const sessionSignals = new EventEmitter();
let mcpConfig: (session: AgentSession, http: boolean) => ACP.McpServer[] = () => [];
let terminate: (pid?: number) => Promise<void> = async () => {};
export function configureSessionHost(config: { mcp: typeof mcpConfig; terminate: typeof terminate }): void {
  mcpConfig = config.mcp;
  terminate = config.terminate;
}
export const adapterPresets = {
  claude: { command: 'npx', args: ['--yes', '@agentclientprotocol/claude-agent-acp@0.81.2'] },
  codex: { command: 'npx', args: ['--yes', '@agentclientprotocol/codex-acp@1.13.1'] },
  gemini: { command: 'gemini', args: ['--experimental-acp'] },
};
function flush(id: string, state: LiveSession): void {
  if (state.text) addEvent(id, state.textType, { text: state.text });
  state.text = '';
}
function update(id: string, notification: ACP.SessionNotification): void {
  const state = live.get(id);
  if (!state || state.loading) return; // session/load replays history already stored locally
  const event = notification.update;
  if (event.sessionUpdate === 'agent_message_chunk' || event.sessionUpdate === 'agent_thought_chunk') {
    const type = event.sessionUpdate === 'agent_message_chunk' ? 'assistant' : 'thought';
    if (state.textType !== type) flush(id, state);
    state.textType = type;
    if (event.content.type === 'text') {
      state.text += event.content.text;
      broadcast({ type: 'agent_delta', sessionId: id, kind: type, text: event.content.text });
    } else addEvent(id, 'content', { content: event.content });
  } else {
    flush(id, state);
    addEvent(id, event.sessionUpdate, event as unknown as Record<string, unknown>);
    if (event.sessionUpdate === 'config_option_update') {
      const session = getSession(id);
      updateSession(id, { metadata: { ...session.metadata, configOptions: event.configOptions } });
    }
  }
}
async function permission(id: string, request: ACP.RequestPermissionRequest): Promise<ACP.RequestPermissionResponse> {
  const session = getSession(id);
  const state = live.get(id)!;
  if (state.cancelled || state.stopping) return { outcome: { outcome: 'cancelled' } };
  const project = getProject(session.project_id);
  const decision = permissionDecision(session.policy, request, project?.config.dangerous_commands);
  const option = request.options.find(o => o.kind === (decision === 'allow' ? 'allow_once' : 'reject_once'));
  if (decision !== 'ask' && option) {
    addEvent(id, 'permission_result', { title: request.toolCall.title, decision });
    return { outcome: { outcome: 'selected', optionId: option.optionId } };
  }
  if (decision === 'deny') return { outcome: { outcome: 'cancelled' } };
  const permissionId = randomUUID();
  addEvent(id, 'permission', { permissionId, ...request });
  updateSession(id, { status: 'waiting', reason: request.toolCall.title ?? 'Запрос разрешения' });
  return new Promise(resolve => state.permissions.set(permissionId, { request, resolve }));
}
export function answerPermission(id: string, permissionId: string, optionId: string): void {
  const state = live.get(id);
  const pending = state?.permissions.get(permissionId);
  if (!pending || !pending.request.options.some(o => o.optionId === optionId)) throw new Error('Запрос разрешения устарел');
  state!.permissions.delete(permissionId);
  pending.resolve({ outcome: { outcome: 'selected', optionId } });
  addEvent(id, 'permission_result', { permissionId, optionId });
  if (!state!.permissions.size) updateSession(id, { status: state!.busy ? 'thinking' : 'ready', reason: '' });
}
export async function startSession(id: string): Promise<LiveSession> {
  if (starting.has(id)) return starting.get(id)!;
  if (live.has(id)) return live.get(id)!;
  const promise = boot(id);
  starting.set(id, promise);
  try { return await promise; } finally { starting.delete(id); }
}
async function boot(id: string): Promise<LiveSession> {
  const session = getSession(id);
  const agent = getAgent(session.agent_id);
  const project = getProject(session.project_id);
  if (!agent || !project) throw new Error('Агент или проект не найден');
  const sdk = await loadSdk();
  const preset = agent.id === 'agent-claude' ? adapterPresets.claude : agent.id === 'agent-codex' ? adapterPresets.codex : null;
  const command = agent.acp_command || preset?.command;
  const args = agent.acp_command ? agent.acp_args ?? [] : preset?.args ?? [];
  if (!command) throw new Error(`У агента «${agent.name}» не задана ACP-команда. Укажите её в настройках агента.`);
  updateSession(id, { status: 'starting', reason: '' });
  const child = spawn(command, args, { cwd: project.repo_path, env: { ...process.env, ...agent.env, ...project.config.extra_env },
    stdio: 'pipe', windowsHide: true, detached: process.platform !== 'win32' });
  const connection = sdk.client({ name: 'Plangent' })
    .onNotification('session/update', p => update(id, p.params))
    .onRequest('session/request_permission', p => permission(id, p.params))
    .connect(sdk.ndJsonStream(Writable.toWeb(child.stdin!) as WritableStream<Uint8Array>, Readable.toWeb(child.stdout!) as ReadableStream<Uint8Array>));
  const state: LiveSession = { connection, process: child, busy: false, stopping: false, loading: !!session.acp_session_id,
    cancelled: false, text: '', textType: '', permissions: new Map() };
  live.set(id, state);
  let stderr = '';
  child.stderr!.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-8000); });
  const failed = (reason: string) => {
    if (state.stopping) return;
    state.stopping = true;
    flush(id, state);
    for (const pending of state.permissions.values()) pending.resolve({ outcome: { outcome: 'cancelled' } });
    connection.close();
    live.delete(id);
    updateSession(id, { status: 'error', reason });
    sessionSignals.emit('error-state', id, reason);
  };
  child.on('error', e => failed(e.message));
  child.on('exit', code => failed(`Адаптер завершился (${code}). ${stderr}`));
  const timeout = setTimeout(() => { failed('Адаптер не ответил за 90 секунд'); void terminate(child.pid); }, 90_000);
  try {
    const initialized = await connection.agent.request('initialize', { protocolVersion: sdk.PROTOCOL_VERSION,
      clientInfo: { name: 'Plangent', version: '0.1.6' }, clientCapabilities: {} });
    updateSession(id, { metadata: { ...session.metadata, ...initialized } });
    const mcpServers = mcpConfig(session, !!initialized.agentCapabilities?.mcpCapabilities?.http);
    if (session.acp_session_id && !initialized.agentCapabilities?.loadSession) {
      throw new Error('Адаптер не поддерживает восстановление. Начните новый чат с контекстом.');
    }
    const response = session.acp_session_id
      ? await connection.agent.request('session/load', { sessionId: session.acp_session_id, cwd: project.repo_path, mcpServers })
      : await connection.agent.request('session/new', { cwd: project.repo_path, mcpServers });
    state.loading = false;
    updateSession(id, { acp_session_id: 'sessionId' in response ? String(response.sessionId) : session.acp_session_id,
      metadata: { ...getSession(id).metadata, ...response }, status: 'ready' });
    const modes = response.modes?.availableModes ?? [];
    const safeMode = modes.find(m => session.policy === 'read-only' && m.id === 'plan')
      ?? modes.find(m => m.id === 'default') ?? modes.find(m => m.id === 'read-only');
    if (safeMode) await connection.agent.request('session/set_mode', { sessionId: getSession(id).acp_session_id!, modeId: safeMode.id });
    else if (modes.some(m => /bypass|full.access|auto/i.test(m.id)) && modes.length) {
      throw new Error('Адаптер не предлагает режим с запросами разрешений');
    }
    if (session.model) await setModel(id, session.model);
    const effort = session.metadata.reasoningEffort || agent.reasoning_effort;
    const effortOption = response.configOptions?.find(o => o.category === 'thought_level');
    if (effort && effortOption) await connection.agent.request('session/set_config_option', { sessionId: getSession(id).acp_session_id!, configId: effortOption.id, value: String(effort) });
    return state;
  } catch (error) {
    failed(String(error));
    await terminate(child.pid);
    throw error;
  } finally { clearTimeout(timeout); }
}
export async function setModel(id: string, model: string): Promise<void> {
  const state = live.get(id);
  if (!state || state.busy) throw new Error('Дождитесь окончания хода');
  const session = getSession(id);
  const options = session.metadata.configOptions as ACP.SessionConfigOption[] | undefined;
  const option = options?.find(o => o.category === 'model');
  if (option) await state.connection.agent.request('session/set_config_option', { sessionId: session.acp_session_id!, configId: option.id, value: model });
  else await state.connection.agent.request('session/set_model', { sessionId: session.acp_session_id!, modelId: model });
  updateSession(id, { model });
}
export async function enableExecution(id: string): Promise<void> {
  const state = await startSession(id);
  if (state.busy) throw new Error('Дождитесь окончания обсуждения');
  const session = getSession(id);
  const modes = (session.metadata.modes as ACP.SessionModeState | undefined)?.availableModes ?? [];
  const mode = modes.find(m => m.id === 'default') ?? modes.find(m => m.id === 'read-only');
  if (mode) await state.connection.agent.request('session/set_mode', { sessionId: session.acp_session_id!, modeId: mode.id });
  updateSession(id, { policy: 'allow-all', status: 'ready', reason: '' });
}
export async function sendPrompt(id: string, content: ACP.ContentBlock[]): Promise<void> {
  const state = await startSession(id);
  if (state.busy) { enqueue(id, JSON.stringify(content)); broadcast({ type: 'agent_queue', sessionId: id }); return; }
  state.busy = true;
  state.cancelled = false;
  const session = getSession(id);
  const text = content.filter(c => c.type === 'text').map(c => (c as ACP.TextContent).text).join('\n');
  updateSession(id, { status: 'thinking', reason: '', ...(session.title === 'Новый чат' ? { title: text.slice(0, 60) || 'Вложение' } : {}) });
  addEvent(id, 'user', { content, text });
  void state.connection.agent.request('session/prompt', { sessionId: session.acp_session_id!, prompt: content }).then(result => {
    flush(id, state);
    addEvent(id, 'turn_end', { stopReason: result.stopReason });
    const latest = getSession(id);
    if (latest.status === 'thinking') updateSession(id, { status: latest.role === 'executor' || latest.role === 'reviewer' ? 'waiting' : 'ready',
      reason: latest.role === 'executor' ? (latest.policy === 'read-only' ? 'Обсуждение завершено' : 'Агент остановился без отчёта') : '' });
    sessionSignals.emit('turn_end', id);
  }).catch(error => {
    if (!state.stopping) { flush(id, state); updateSession(id, { status: 'error', reason: String(error) }); sessionSignals.emit('error-state', id, String(error)); }
  }).finally(() => {
    state.busy = false;
    const next = queuedPrompts(id)[0];
    if (next && !state.cancelled && !state.stopping && getSession(id).status === 'ready') {
      editQueued(id, next.id);
      broadcast({ type: 'agent_queue', sessionId: id });
      void sendPrompt(id, JSON.parse(next.content)).catch(error => updateSession(id, { status: 'error', reason: String(error) }));
    }
  });
}
export async function cancelSession(id: string): Promise<void> {
  const state = live.get(id);
  if (!state) return;
  state.cancelled = true;
  for (const [permissionId, pending] of state.permissions) {
    pending.resolve({ outcome: { outcome: 'cancelled' } });
    addEvent(id, 'permission_result', { permissionId, cancelled: true });
  }
  state.permissions.clear();
  await state.connection.agent.notify('session/cancel', { sessionId: getSession(id).acp_session_id! });
}
export async function closeSession(id: string): Promise<void> {
  const state = live.get(id);
  if (!state) return;
  await cancelSession(id).catch(() => {});
  state.stopping = true;
  flush(id, state);
  state.connection.close();
  await terminate(state.process.pid);
  live.delete(id);
}
export async function shutdownSessions(): Promise<void> { await Promise.all([...live.keys()].map(closeSession)); }
export function snapshot(id: string) {
  const state = live.get(id);
  return { session: getSession(id), queue: queuedPrompts(id), streaming: state ? { text: state.text, type: state.textType } : null,
    permissions: state ? [...state.permissions].map(([permissionId, p]) => ({ permissionId, ...p.request })) : [] };
}
