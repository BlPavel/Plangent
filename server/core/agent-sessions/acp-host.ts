import { buildCodeFixerBriefing } from '../library/code-fixer-instruction';
import { buildLibrarianPrompt } from '../orchestration/prompts';
import type * as ACP from '@agentclientprotocol/sdk';
import { Readable, Writable } from 'stream';
import spawn from 'cross-spawn';
import { randomUUID } from 'crypto';
import os from 'os';
import { EventEmitter } from 'events';
import { getAgent } from '../agents';
import { getProject } from '../projects';
import { readOnlyRoots, workspaceBriefing, writableRoots } from '../projects/workspace';
import { broadcast } from '../shared/events';
import { addEvent, getSession, history, updateSession } from './sessions';
import { getAcpOptions, saveAcpOptions, type AcpOptions } from '../agents/acp-options';
import { enqueue, queuedPrompts, editQueued } from './prompt-queue';
import { permissionDecision } from './permissions';
import { agentEnv } from './env';
import { agentPresets, presetForAgentId } from '../agents/presets';
import type { AgentSession, PermissionPolicy } from './types';
import type { Agent } from '../../models';

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
function adapterCommand(agent: Agent): { command: string; args: string[] } {
  const preset = agentPresets[presetForAgentId[agent.id]];
  const command = agent.acp_command || preset?.acp_command;
  if (!command) throw new Error(`У агента «${agent.name}» не задана ACP-команда. Укажите её в настройках агента.`);
  return { command, args: agent.acp_command ? agent.acp_args ?? [] : preset?.acp_args ?? [] };
}
/** Values the agent reported for a config option; empty when it reported none (then anything is tried). */
function offered(options: ACP.SessionConfigOption[] | null | undefined, match: (o: ACP.SessionConfigOption) => boolean): string[] {
  const option = options?.find(match) as { options?: { value: string; options?: { value: string }[] }[] } | undefined;
  return (option?.options ?? []).flatMap(c => c.options ?? [c]).map(c => c.value);
}
const probes = new Map<string, Promise<AcpOptions>>();
/**
 * Models, modes and reasoning levels the agent offers. Cached from real sessions; when nothing is cached
 * yet, a throwaway session is opened just to read them (no prompt is sent, so nothing is spent).
 */
export function agentOptions(agentId: string, refresh = false): Promise<AcpOptions> {
  const cached = getAcpOptions(agentId);
  const stale = !cached || Date.now() - cached.at > 24 * 60 * 60_000;
  if (cached && !refresh) { if (stale && !probes.has(agentId)) void probeAgent(agentId).catch(() => {}); return Promise.resolve(cached); }
  return probeAgent(agentId);
}
function probeAgent(agentId: string): Promise<AcpOptions> {
  if (probes.has(agentId)) return probes.get(agentId)!;
  const job = (async () => {
    const agent = getAgent(agentId);
    if (!agent) throw new Error('Агент не найден');
    const { command, args } = adapterCommand(agent);
    const sdk = await loadSdk();
    const child = spawn(command, args, { cwd: os.tmpdir(), env: agentEnv(process.env, agent.env), stdio: 'pipe', windowsHide: true, detached: process.platform !== 'win32' });
    const connection = sdk.client({ name: 'Plangent' })
      .onNotification('session/update', () => {})
      .onRequest('session/request_permission', async () => ({ outcome: { outcome: 'cancelled' as const } }))
      .connect(sdk.ndJsonStream(Writable.toWeb(child.stdin!) as WritableStream<Uint8Array>, Readable.toWeb(child.stdout!) as ReadableStream<Uint8Array>));
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        (async () => {
          const init = await connection.agent.request('initialize', { protocolVersion: sdk.PROTOCOL_VERSION, clientInfo: { name: 'Plangent', version: '0.3.0' }, clientCapabilities: {} });
          return saveAcpOptions(agentId, await connection.agent.request('session/new', { cwd: os.tmpdir(), mcpServers: [] }), init);
        })(),
        new Promise<never>((_, reject) => { child.on('error', reject); timer = setTimeout(() => reject(new Error('Агент не ответил за 90 секунд')), 90_000); }),
      ]);
    } finally {
      clearTimeout(timer);
      connection.close();
      await terminate(child.pid);
    }
  })().finally(() => probes.delete(agentId));
  probes.set(agentId, job);
  return job;
}
/** Chat transcript for an agent that lost its own memory of the conversation. */
function transcript(id: string): string {
  return history(id).filter(e => e.type === 'user' || e.type === 'assistant').map(e => `${e.type}: ${e.payload.text ?? ''}`).join('\n').slice(-60_000);
}
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
  } else if (event.sessionUpdate === 'usage_update') {
    // Status-bar data, not conversation: keep it in metadata and don't split the streamed message.
    const session = getSession(id);
    updateSession(id, { metadata: { ...session.metadata, usage: { used: event.used, size: event.size, cost: event.cost ?? (session.metadata.usage as { cost?: unknown } | undefined)?.cost } } });
  } else if (event.sessionUpdate === 'current_mode_update') {
    rememberMode(id, event.currentModeId);
  } else {
    flush(id, state);
    addEvent(id, event.sessionUpdate, event as unknown as Record<string, unknown>);
    if (event.sessionUpdate === 'config_option_update') {
      const session = getSession(id);
      updateSession(id, { metadata: { ...session.metadata, configOptions: event.configOptions } });
    }
  }
}
function rememberMode(id: string, modeId: string): void {
  const session = getSession(id);
  const modes = session.metadata.modes as ACP.SessionModeState | undefined;
  const configOptions = (session.metadata.configOptions as ACP.SessionConfigOption[] | undefined)
    ?.map(o => o.category === 'mode' ? { ...o, currentValue: modeId } as ACP.SessionConfigOption : o);
  updateSession(id, { metadata: { ...session.metadata, ...(modes ? { modes: { ...modes, currentModeId: modeId } } : {}), ...(configOptions ? { configOptions } : {}) } });
}
/** Modes that skip permission prompts would bypass Plangent's own policy, so they are never offered. */
export const isBypassMode = (modeId: string) => /bypass|full.?access|yolo|dangerous/i.test(modeId);
async function permission(id: string, request: ACP.RequestPermissionRequest): Promise<ACP.RequestPermissionResponse> {
  const session = getSession(id);
  const state = live.get(id)!;
  if (state.cancelled || state.stopping) return { outcome: { outcome: 'cancelled' } };
  const project = getProject(session.project_id);
  // Codex asks with little more than the toolCallId; what the call is was sent in the earlier tool_call update.
  const announced = history(id).filter(e => e.type === 'tool_call' && e.payload.toolCallId === request.toolCall.toolCallId).pop()?.payload;
  const toolCall = { ...(announced as Partial<ACP.ToolCallUpdate> | undefined), ...Object.fromEntries(Object.entries(request.toolCall).filter(([, v]) => v != null)) } as ACP.ToolCallUpdate;
  const decision = permissionDecision(session.policy, { ...request, toolCall }, project?.config.dangerous_commands,
    project ? { writable: session.role === 'code-fixer' ? [project.repo_path] : writableRoots(project), readOnly: readOnlyRoots() } : undefined, session.role);
  const option = request.options.find(o => o.kind === (decision === 'allow' ? 'allow_once' : 'reject_once'));
  if (decision !== 'ask' && option) {
    addEvent(id, 'permission_result', { title: toolCall.title, decision });
    return { outcome: { outcome: 'selected', optionId: option.optionId } };
  }
  if (decision === 'deny') return { outcome: { outcome: 'cancelled' } };
  const permissionId = randomUUID();
  addEvent(id, 'permission', { permissionId, ...request, toolCall });
  updateSession(id, { status: 'waiting', reason: toolCall.title ?? 'Запрос разрешения' });
  return new Promise(resolve => state.permissions.set(permissionId, { request: { ...request, toolCall }, resolve }));
}
export function answerPermission(id: string, permissionId: string, optionId: string): void {
  const state = live.get(id);
  const pending = state?.permissions.get(permissionId);
  if (!pending || !pending.request.options.some(o => o.optionId === optionId)) throw new Error('Запрос разрешения устарел');
  state!.permissions.delete(permissionId);
  pending.resolve({ outcome: { outcome: 'selected', optionId } });
  addEvent(id, 'permission_result', { permissionId, optionId });
  if (!state!.permissions.size) {
    updateSession(id, { status: state!.busy ? 'thinking' : 'ready', reason: '' });
    if (state!.busy) sessionSignals.emit('thinking', id);
  }
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
  const { command, args } = adapterCommand(agent);
  updateSession(id, { status: 'starting', reason: '' });
  // The project folder reaches the agent through session/new. Starting the process there would make npx
  // honor the project's .npmrc (e.g. a corporate registry) when it resolves the adapter itself.
  const child = spawn(command, args, { cwd: os.tmpdir(), env: agentEnv(process.env, agent.env, project.config.extra_env),
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
  const exited = new Promise<void>(resolve => child.once('exit', () => resolve()));
  const timeout = setTimeout(() => { failed('Адаптер не ответил за 90 секунд'); void terminate(child.pid); }, 90_000);
  try {
    const initialized = await connection.agent.request('initialize', { protocolVersion: sdk.PROTOCOL_VERSION,
      clientInfo: { name: 'Plangent', version: '0.3.0' }, clientCapabilities: {} });
    updateSession(id, { metadata: { ...session.metadata, ...initialized } });
    const mcpServers = mcpConfig(session, !!initialized.agentCapabilities?.mcpCapabilities?.http);
    if (session.acp_session_id && !initialized.agentCapabilities?.loadSession) {
      throw new Error('Адаптер не поддерживает восстановление. Начните новый чат с контекстом.');
    }
    let response: ACP.NewSessionResponse | ACP.LoadSessionResponse;
    // A group works in its service folder; its projects live elsewhere and join the session's scope.
    const extra = writableRoots(project).slice(1);
    const where = { cwd: project.repo_path, mcpServers,
      ...(extra.length && initialized.agentCapabilities?.sessionCapabilities?.additionalDirectories ? { additionalDirectories: extra } : {}) };
    if (session.acp_session_id) {
      try {
        response = await connection.agent.request('session/load', { sessionId: session.acp_session_id, ...where });
      } catch (error) {
        if ((error as { code?: number }).code !== -32002 && !/resource not found/i.test(String(error))) throw error;
        // The agent never persisted this conversation (no finished turn before a restart). Start fresh
        // and hand it the chat transcript with the next prompt instead of failing forever.
        response = await connection.agent.request('session/new', where);
        const hasHistory = history(id).some(e => e.type === 'user' || e.type === 'assistant');
        updateSession(id, { metadata: { ...getSession(id).metadata, needsContext: hasHistory } });
        addEvent(id, 'notice', { text: hasHistory
          ? 'Агент не нашёл прежнюю сессию, поэтому начата новая. История чата будет передана ему вместе со следующим сообщением.'
          : 'Агент не нашёл прежнюю сессию, поэтому начата новая.' });
      }
    } else {
      response = await connection.agent.request('session/new', where);
      saveAcpOptions(agent.id, response, initialized);
    }
    state.loading = false;
    updateSession(id, { acp_session_id: 'sessionId' in response ? String(response.sessionId) : session.acp_session_id,
      metadata: { ...getSession(id).metadata, ...response }, status: 'ready' });
    const modes = response.modes?.availableModes ?? [];
    // 'discuss' is chosen before the agent's own mode list is known; map it onto its plan/read-only mode.
    const preferred = getSession(id).metadata.preferredMode as string | undefined;
    // Planner and librarian write through MCP; the agent's plan mode can interrupt that workflow.
    const discuss = (session.policy === 'read-only' && session.role !== 'planner' && session.role !== 'librarian') || preferred === 'discuss';
    const safeMode = (preferred && !isBypassMode(preferred) ? modes.find(m => m.id === preferred) : undefined)
      ?? (discuss ? modes.find(m => /^plan$|read.?only/i.test(m.id)) : undefined)
      ?? modes.find(m => m.id === 'default') ?? modes.find(m => m.id === 'read-only');
    if (safeMode) {
      await connection.agent.request('session/set_mode', { sessionId: getSession(id).acp_session_id!, modeId: safeMode.id });
      rememberMode(id, safeMode.id);
    }
    else if (modes.some(m => /bypass|full.access|auto/i.test(m.id)) && modes.length) {
      throw new Error('Адаптер не предлагает режим с запросами разрешений');
    }
    // A default saved before the agent changed its lineup must not break the start: skip unknown values.
    const models = offered(response.configOptions, o => o.category === 'model');
    if (session.model && (!models.length || models.includes(session.model))) await setModel(id, session.model);
    else if (session.model) addEvent(id, 'notice', { text: `Агент больше не предлагает модель «${session.model}», используется его модель по умолчанию.` });
    // Re-apply options chosen in the UI (reasoning depth, Codex "plan first", …); the agent's
    // configured reasoning effort is only the fallback default.
    const preferredConfig = { ...(getSession(id).metadata.preferredConfig as Record<string, string> | undefined) };
    const effortOption = response.configOptions?.find(o => o.category === 'thought_level');
    const effort = String(session.metadata.reasoningEffort || agent.reasoning_effort || '');
    const efforts = offered(response.configOptions, o => o.category === 'thought_level');
    if (effortOption && effort && efforts.includes(effort) && !(effortOption.id in preferredConfig)) preferredConfig[effortOption.id] = effort;
    for (const [configId, value] of Object.entries(preferredConfig)) {
      if (response.configOptions?.some(o => o.id === configId && o.category !== 'model' && o.category !== 'mode')) await setConfig(id, configId, value);
    }
    return state;
  } catch (error) {
    // A dying adapter first surfaces as "ACP connection closed"; give it a moment to exit so the
    // reason carries its stderr (npm registry errors, crashes) instead.
    await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 1000))]);
    failed(stderr.trim() ? `${String(error)}\n${stderr.trim()}` : String(error));
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
  if (option) {
    const result = await state.connection.agent.request('session/set_config_option', { sessionId: session.acp_session_id!, configId: option.id, value: model });
    if (result?.configOptions) updateSession(id, { metadata: { ...getSession(id).metadata, configOptions: result.configOptions } });
  } else await state.connection.agent.request('session/set_model', { sessionId: session.acp_session_id!, modelId: model });
  updateSession(id, { model });
}
/** Any other agent option (reasoning depth, Codex collaboration mode, …); remembered so a restarted session keeps it. */
export async function setConfig(id: string, configId: string, value: string): Promise<void> {
  const session = getSession(id);
  const option = (session.metadata.configOptions as ACP.SessionConfigOption[] | undefined)?.find(o => o.id === configId);
  if (!option) throw new Error('Агент не поддерживает эту настройку');
  if (option.category === 'mode') return setMode(id, value);
  if (option.category === 'model') return setModel(id, value);
  updateSession(id, { metadata: { ...session.metadata, preferredConfig: { ...(session.metadata.preferredConfig as Record<string, string> | undefined), [configId]: value } } });
  const state = live.get(id);
  if (!state || !session.acp_session_id) return; // applied when the session next starts
  const result = await state.connection.agent.request('session/set_config_option', { sessionId: session.acp_session_id, configId, value });
  if (result?.configOptions) updateSession(id, { metadata: { ...getSession(id).metadata, configOptions: result.configOptions } });
}
export async function setMode(id: string, modeId: string): Promise<void> {
  if (isBypassMode(modeId)) throw new Error('Этот режим недоступен: он отключает запросы разрешений');
  const session = getSession(id);
  updateSession(id, { metadata: { ...session.metadata, preferredMode: modeId } });
  const state = live.get(id);
  if (state && !state.loading && !starting.has(id) && session.acp_session_id) {
    const option = (session.metadata.configOptions as ACP.SessionConfigOption[] | undefined)?.find(o => o.category === 'mode');
    if (option) await state.connection.agent.request('session/set_config_option', { sessionId: session.acp_session_id, configId: option.id, value: modeId });
    else await state.connection.agent.request('session/set_mode', { sessionId: session.acp_session_id, modeId });
  }
  rememberMode(id, modeId); // otherwise applied when the session next starts
}
export async function enableExecution(id: string, policy: PermissionPolicy = 'allow-all'): Promise<void> {
  const state = await startSession(id);
  if (state.busy) throw new Error('Дождитесь окончания обсуждения');
  const session = getSession(id);
  const modes = (session.metadata.modes as ACP.SessionModeState | undefined)?.availableModes ?? [];
  const mode = modes.find(m => m.id === 'default') ?? modes.find(m => m.id === 'read-only');
  if (mode) await state.connection.agent.request('session/set_mode', { sessionId: session.acp_session_id!, modeId: mode.id });
  updateSession(id, { policy, status: 'ready', reason: '' });
}
export async function sendPrompt(id: string, content: ACP.ContentBlock[]): Promise<void> {
  const state = await startSession(id);
  if (state.busy) { enqueue(id, JSON.stringify(content)); broadcast({ type: 'agent_queue', sessionId: id }); return; }
  state.busy = true;
  state.cancelled = false;
  const session = getSession(id);
  const text = content.filter(c => c.type === 'text').map(c => (c as ACP.TextContent).text).join('\n');
  updateSession(id, { status: 'thinking', reason: '', ...(session.title === 'Новый чат' ? { title: text.slice(0, 60) || 'Вложение' } : {}) });
  sessionSignals.emit('thinking', id);
  // `briefing` is Plangent's instructions for the session: sent with the first message (and again if the
  // agent lost the conversation) but never shown as something the developer wrote.
  // The workspace note (group projects, reference catalog) goes with the first message of every chat.
  const project = getProject(session.project_id);
  const workspace = project ? workspaceBriefing(project) : '';
  const roleBriefing = session.role === 'code-fixer' ? buildCodeFixerBriefing(session.project_id)
    : session.role === 'librarian' ? buildLibrarianPrompt(project?.name ?? session.project_id) : '';
  const briefing = [workspace, roleBriefing || (typeof session.metadata.briefing === 'string' ? session.metadata.briefing : '')].filter(Boolean).join('\n\n');
  const withBriefing = briefing && (!session.metadata.briefed || session.metadata.needsContext);
  const prompt: ACP.ContentBlock[] = [
    ...(withBriefing ? [{ type: 'text' as const, text: briefing }] : []),
    ...(session.metadata.needsContext ? [{ type: 'text' as const, text: `Контекст предыдущего разговора (может быть обрезан):\n${transcript(id)}\n\nНовое сообщение:` }] : []),
    ...content,
  ];
  if (session.metadata.needsContext || withBriefing) updateSession(id, { metadata: { ...getSession(id).metadata, needsContext: false, ...(briefing ? { briefed: true } : {}) } });
  addEvent(id, 'user', { content, text, ...(withBriefing ? { briefing: true } : {}) });
  void state.connection.agent.request('session/prompt', { sessionId: session.acp_session_id!, prompt }).then(result => {
    flush(id, state);
    addEvent(id, 'turn_end', { stopReason: result.stopReason });
    const latest = getSession(id);
    // A session being shut down is not "waiting": whoever closes it sets the final status.
    if (latest.status === 'thinking' && !state.stopping) updateSession(id, { status: latest.role === 'executor' || latest.role === 'reviewer' ? 'waiting' : 'ready',
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
