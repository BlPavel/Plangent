import { moduleDependencies } from '../dependencies';
import { commandPrompt, sessionCommands } from './commands';
import { idleDeadline } from './idle-policy';
import { buildCodeFixerBriefing, librarianSectionBriefing } from '../../library';
import type { buildLibrarianPrompt } from '../../preparation';
import type * as ACP from '../../../infrastructure/acp/types';
import { startAdapter, stopAdapter, configureAdapterTermination } from '../../../infrastructure/acp/process';
import { connectAdapter, type AdapterConnection } from '../../../infrastructure/acp/client';
import { randomUUID } from 'crypto';
import os from 'os';
import path from 'path';
import { EventEmitter } from 'events';
import { getAgent } from '../catalog';
import { getProject } from '../../projects';
import type { getTask } from '../../tasks';
import type { listAnalysisSections } from '../../preparation';
import { readOnlyRoots, workspaceBriefing, mentionedReferences, WORKSPACE_BRIEFING_VERSION } from '../../projects';
import type { rootForSession, writableRootsForSession, assertTaskWorkspaceReady } from '../../workspaces';
import { broadcast } from '../../shared';
import { addEvent, getSession, history, toolCallPayload, updateSession, updateAgentTitle } from './sessions';
import { getAcpOptions, saveAcpOptions, type AcpOptions } from '../catalog/acp-options';
import { enqueue, queuedPrompts, editQueued } from './prompt-queue';
import { permissionDecision, shellGitDecision, commandToolAvailable, COMMAND_REDIRECT_REASON } from './permissions';
import { agentEnv } from './env';
import { agentSessionSettings } from './session-settings';
import { isBypassMode, selectSessionMode } from './session-modes';
import { APP_VERSION } from '../../shared';
import { agentPresets, presetForAgentId } from '../catalog/presets';
import { resolveAdapter } from '../catalog/adapter-install';
import type { AgentSession, PermissionPolicy } from './types';
import type { Agent } from '../../../models';

interface LiveSession {
  connection: AdapterConnection;
  process: ReturnType<typeof startAdapter>;
  busy: boolean;
  stopping: boolean;
  loading: boolean;
  cancelled: boolean;
  gitForTurn: boolean;
  turnId: string;
  turnAbort: AbortController | null;
  idleSince: number;
  text: string;
  textType: string;
  permissions: Map<string, { request: ACP.RequestPermissionRequest; resolve: (response: ACP.RequestPermissionResponse) => void }>;
}
const live = new Map<string, LiveSession>();
const starting = new Map<string, Promise<LiveSession>>();
const stoppingProcesses = new Map<string, Promise<void>>();
export const sessionSignals = new EventEmitter();
let mcpConfig: (session: AgentSession, http: boolean) => ACP.McpServer[] = () => [];
const terminate = stopAdapter;
export function configureSessionHost(config: { mcp: typeof mcpConfig; terminate: typeof terminate }): void {
  mcpConfig = config.mcp;
  configureAdapterTermination(config.terminate);
}
/** The configured start command, before a pinned adapter is resolved to its installed copy. */
function launchCommand(agent: Agent): { command: string; args: string[] } {
  const preset = agentPresets[presetForAgentId[agent.id]];
  const command = agent.acp_command || preset?.acp_command;
  if (!command) throw new Error(`У агента «${agent.name}» не задана ACP-команда. Укажите её в настройках агента.`);
  return { command, args: agent.acp_command ? agent.acp_args ?? [] : preset?.acp_args ?? [] };
}
const launchKey = (agent: Agent) => { try { return JSON.stringify(launchCommand(agent)); } catch { return ''; } };
async function adapterCommand(agent: Agent, env: Record<string, string | undefined>): Promise<{ command: string; args: string[] }> {
  const { command, args } = launchCommand(agent);
  return resolveAdapter(command, args, env);
}
/** Cached options, unless they were reported by another adapter (e.g. a preset moved to a new version). */
export function cachedAgentOptions(agentId: string): AcpOptions | null {
  const cached = getAcpOptions(agentId), agent = getAgent(agentId);
  return cached && agent && cached.launch === launchKey(agent) ? cached : null;
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
  const cached = cachedAgentOptions(agentId);
  const stale = !cached || Date.now() - cached.at > 24 * 60 * 60_000;
  if (cached && !cached.commands) return probeAgent(agentId);
  if (cached && !refresh) { if (stale && !probes.has(agentId)) void probeAgent(agentId).catch(() => {}); return Promise.resolve(cached); }
  return probeAgent(agentId);
}
function probeAgent(agentId: string): Promise<AcpOptions> {
  if (probes.has(agentId)) return probes.get(agentId)!;
  const job = (async () => {
    const agent = getAgent(agentId);
    if (!agent) throw new Error('Агент не найден');
    const env = agentEnv(process.env, agent.env);
    const { command, args } = await adapterCommand(agent, env);
    const child = startAdapter(command, args, env);
    let commands: { name: string; description: string }[] = [];
    let commandsReady: (() => void) | undefined;
    const receivedCommands = new Promise<void>(resolve => { commandsReady = resolve; });
    const connection = await connectAdapter(child, { update: event => {
      if (event.update.sessionUpdate === 'available_commands_update') {
        commands = event.update.availableCommands;
        commandsReady?.();
      }
    }, permission: async () => ({ outcome: { outcome: 'cancelled' } }) });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        (async () => {
          const init = await connection.initialize(APP_VERSION);
          const response = await connection.newSession({ cwd: os.tmpdir(), mcpServers: [], ...agentSessionSettings(agent) });
          let commandsTimer: ReturnType<typeof setTimeout> | undefined;
          await Promise.race([receivedCommands, new Promise<void>(resolve => { commandsTimer = setTimeout(resolve, 1500); })]);
          clearTimeout(commandsTimer);
          return saveAcpOptions(agentId, { ...response, commands }, launchKey(agent), init);
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
  if (!state) return;
  const event = notification.update;
  // Metadata can change while session/load replays the conversation; it is not a chat event.
  if (event.sessionUpdate === 'session_info_update') {
    updateAgentTitle(id, event.title);
    return;
  }
  if (state.loading) return; // session/load replays history already stored locally
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
    ?.map(o => o.category === 'mode' || o.id === 'mode' ? { ...o, currentValue: modeId } as ACP.SessionConfigOption : o);
  updateSession(id, { metadata: { ...session.metadata, ...(modes ? { modes: { ...modes, currentModeId: modeId } } : {}), ...(configOptions ? { configOptions } : {}) } });
}
export { isBypassMode } from './session-modes';
function availableModeIds(source: { modes?: ACP.SessionModeState | null; configOptions?: ACP.SessionConfigOption[] | null }): string[] {
  const configured = offered(source.configOptions, option => option.category === 'mode' || option.id === 'mode');
  return configured.length ? configured : (source.modes?.availableModes ?? []).map(mode => mode.id);
}
async function applyMode(id: string, state: LiveSession, modeId: string): Promise<void> {
  const session = getSession(id);
  const option = (session.metadata.configOptions as ACP.SessionConfigOption[] | undefined)?.find(o => o.category === 'mode' || o.id === 'mode');
  if (option) {
    const result = await state.connection.setConfig({ sessionId: session.acp_session_id!, configId: option.id, value: modeId });
    if (result?.configOptions) updateSession(id, { metadata: { ...getSession(id).metadata, configOptions: result.configOptions } });
  } else await state.connection.setMode({ sessionId: session.acp_session_id!, modeId });
  rememberMode(id, modeId);
}
export async function requestDeveloperPermission(id: string, request: ACP.RequestPermissionRequest): Promise<ACP.RequestPermissionResponse> {
  const session = getSession(id);
  const state = live.get(id)!;
  if (state.cancelled || state.stopping) return { outcome: { outcome: 'cancelled' } };
  const project = getProject(session.project_id);
  // Codex asks with little more than the toolCallId; what the call is was sent in the earlier tool_call update.
  const sessionRoot = await moduleDependencies.workspaces.rootForSession(session);
  const announced = toolCallPayload(id, request.toolCall.toolCallId);
  const toolCall = { ...(announced as Partial<ACP.ToolCallUpdate> | undefined), ...Object.fromEntries(Object.entries(request.toolCall).filter(([, v]) => v != null)) } as ACP.ToolCallUpdate;
  const conflictFiles = session.role === 'conflict-resolver' && project
    ? ((session.metadata.conflict_paths as string[] | undefined) ?? []).map(file => path.resolve(sessionRoot, file)) : undefined;
  const redirect = session.policy !== 'read-only' && commandToolAvailable(session);
  const decision = permissionDecision(session.policy, { ...request, toolCall }, project?.config.dangerous_commands,
    project ? { writable: await moduleDependencies.workspaces.writableRootsForSession(session), readOnly: readOnlyRoots(), restrictWrites: sessionRoot !== project.repo_path,
      ...(conflictFiles ? { files: conflictFiles } : {}) } : undefined, session.role, redirect);
  const option = request.options.find(o => o.kind === (decision === 'allow' ? 'allow_once' : 'reject_once'));
  const gitDenied = decision === 'deny' && shellGitDecision(toolCall) === 'deny';
  const gitReason = gitDenied ? 'Shell Git command refused. Request repository changes with the Plangent git_action tool.'
    : decision === 'deny' && redirect && toolCall.kind === 'execute' ? COMMAND_REDIRECT_REASON : undefined;
  if (decision !== 'ask' && option) {
    addEvent(id, 'permission_result', { title: toolCall.title, toolCallId: toolCall.toolCallId, decision, ...(gitReason ? { gitReason } : {}) });
    return { outcome: { outcome: 'selected', optionId: option.optionId }, ...(gitReason ? { _meta: { reason: gitReason } } : {}) };
  }
  if (decision === 'deny') {
    if (gitReason) addEvent(id, 'permission_result', { title: toolCall.title, toolCallId: toolCall.toolCallId, decision, gitReason });
    return { outcome: { outcome: 'cancelled' }, ...(gitReason ? { _meta: { reason: gitReason } } : {}) };
  }
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
/** Ask through the same pending-permission channel as ACP; session policy never bypasses this. */
export function captureGitTurn(id: string): AbortSignal {
  const state = live.get(id);
  if (!state?.busy || !state.turnId || !state.turnAbort || state.cancelled || state.stopping) throw new Error('Git turn ended');
  return state.turnAbort.signal;
}
export async function authorizeGitAction(id: string, title: string, alwaysAsk: boolean, expectedSignal?: AbortSignal): Promise<AbortSignal | null> {
  const state = live.get(id);
  const session = getSession(id);
  if (!state || !state.busy || state.cancelled || state.stopping ||
      !['chat', 'task-chat', 'errand'].includes(session.role) || session.metadata.branch_review || session.metadata.mr_private || getProject(session.project_id)?.kind !== 'project') return null;
  const turnId = state.turnId;
  const signal = state.turnAbort?.signal;
  if (!turnId || !signal || expectedSignal && expectedSignal !== signal) return null;
  if (state.gitForTurn && !alwaysAsk) {
    addEvent(id, 'notice', { text: title });
    return signal;
  }
  const allowed = await askAllowReject(id, state, session, title);
  return allowed && !state.cancelled && !state.stopping && state.busy && state.turnId === turnId ? signal : null;
}
async function askAllowReject(id: string, state: LiveSession, session: AgentSession, title: string): Promise<boolean> {
  const permissionId = randomUUID();
  const request: ACP.RequestPermissionRequest = {
    sessionId: session.acp_session_id ?? id,
    toolCall: { toolCallId: permissionId, title, kind: 'other' },
    options: [
      { optionId: 'allow', kind: 'allow_once', name: 'Разрешить' },
      { optionId: 'reject', kind: 'reject_once', name: 'Отклонить' },
    ],
  };
  addEvent(id, 'permission', { permissionId, ...request });
  updateSession(id, { status: 'waiting', reason: title });
  const response = await new Promise<ACP.RequestPermissionResponse>(resolve => state.permissions.set(permissionId, { request, resolve }));
  return response.outcome.outcome === 'selected' && response.outcome.optionId === 'allow';
}
/** The abort signal of the running turn: it fires when the developer cancels or the session stops. */
export function captureTurn(id: string): AbortSignal {
  const state = live.get(id);
  if (!state?.busy || !state.turnAbort || state.cancelled || state.stopping) throw new Error('The turn has ended');
  return state.turnAbort.signal;
}
/** Ask the developer about a shell command, through the same pending-permission channel as ACP. */
export async function authorizeCommand(id: string, title: string, signal: AbortSignal): Promise<boolean> {
  const state = live.get(id);
  if (!state || state.cancelled || state.stopping || state.turnAbort?.signal !== signal) return false;
  const allowed = await askAllowReject(id, state, getSession(id), title);
  return allowed && !state.cancelled && !state.stopping && state.turnAbort?.signal === signal && !signal.aborted;
}
export async function startSession(id: string): Promise<LiveSession> {
  await stoppingProcesses.get(id);
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
  if (session.task_id && !session.metadata.mr_private) moduleDependencies.workspaces.assertTaskWorkspaceReady(session.task_id);
  const sessionRoot = await moduleDependencies.workspaces.rootForSession(session);
  updateSession(id, { status: 'starting', reason: '' });
  const env = agentEnv(process.env, agent.env, project.config.extra_env, moduleDependencies.workspaces.envForSession(session));
  let command: string, args: string[];
  try { ({ command, args } = await adapterCommand(agent, env)); }
  catch (error) { updateSession(id, { status: 'error', reason: String(error) }); throw error; }
  // The project folder reaches the agent through session/new. Starting the process there would make npx
  // honor the project's .npmrc (e.g. a corporate registry) when it resolves the adapter itself.
  const child = startAdapter(command, args, env);
  const connection = await connectAdapter(child, { update: event => update(id, event), permission: request => requestDeveloperPermission(id, request) });
  const state: LiveSession = { connection, process: child, busy: false, stopping: false, loading: !!session.acp_session_id,
    cancelled: false, gitForTurn: false, turnId: '', turnAbort: null, idleSince: Date.now(), text: '', textType: '', permissions: new Map() };
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
    const initialized = await connection.initialize(APP_VERSION);
    updateSession(id, { metadata: { ...session.metadata, ...initialized } });
    const mcpServers = mcpConfig(session, !!initialized.agentCapabilities?.mcpCapabilities?.http);
    let response: ACP.NewSessionResponse | ACP.LoadSessionResponse;
    // A group works in its service folder; its projects live elsewhere and join the session's scope.
    const extra = (await moduleDependencies.workspaces.writableRootsForSession(session)).slice(1);
    const where = { cwd: sessionRoot, mcpServers, ...agentSessionSettings(agent),
      ...(extra.length && initialized.agentCapabilities?.sessionCapabilities?.additionalDirectories ? { additionalDirectories: extra } : {}) };
    if (session.acp_session_id && initialized.agentCapabilities?.loadSession) {
      try {
        response = await connection.loadSession({ sessionId: session.acp_session_id, ...where });
      } catch (error) {
        if ((error as { code?: number }).code !== -32002 && !/resource not found/i.test(String(error))) throw error;
        // The agent never persisted this conversation (no finished turn before a restart). Start fresh
        // and hand it the chat transcript with the next prompt instead of failing forever.
        response = await connection.newSession(where);
        const hasHistory = history(id).some(e => e.type === 'user' || e.type === 'assistant');
        updateSession(id, { metadata: { ...getSession(id).metadata, needsContext: hasHistory } });
        addEvent(id, 'notice', { text: hasHistory
          ? 'Агент не нашёл прежнюю сессию, поэтому начата новая. История чата будет передана ему вместе со следующим сообщением.'
          : 'Агент не нашёл прежнюю сессию, поэтому начата новая.' });
      }
    } else {
      response = await connection.newSession(where);
      if (session.acp_session_id) {
        updateSession(id, { metadata: { ...getSession(id).metadata, needsContext: false, briefed: false } });
        addEvent(id, 'notice', { text: 'Агент перезапущен без прежнего разговора' });
      }
      saveAcpOptions(agent.id, response, launchKey(agent), initialized);
    }
    state.loading = false;
    updateSession(id, { acp_session_id: 'sessionId' in response ? String(response.sessionId) : session.acp_session_id,
      metadata: { ...getSession(id).metadata, ...response }, status: 'ready' });
    const modes = availableModeIds(getSession(id).metadata);
    // 'discuss' is chosen before the agent's own mode list is known; map it onto its plan/read-only mode.
    const preferred = getSession(id).metadata.preferredMode as string | undefined;
    // Planner and librarian write through MCP; the agent's plan mode can interrupt that workflow.
    const discuss = (session.policy === 'read-only' && session.role !== 'planner' && session.role !== 'librarian' && session.role !== 'committer') || preferred === 'discuss';
    const safeMode = selectSessionMode(modes, session.policy, preferred, discuss, session.role);
    if (safeMode) {
      await applyMode(id, state, safeMode);
    }
    else if (modes.some(mode => /bypass|full.access|auto/i.test(mode)) && modes.length) {
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
    state.idleSince = Date.now();
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
  if (!state) { updateSession(id, { model }); return; } // applied when the session next starts
  if (state.busy) throw new Error('Дождитесь окончания хода');
  const session = getSession(id);
  const options = session.metadata.configOptions as ACP.SessionConfigOption[] | undefined;
  const option = options?.find(o => o.category === 'model');
  if (option) {
    const result = await state.connection.setConfig({ sessionId: session.acp_session_id!, configId: option.id, value: model });
    if (result?.configOptions) updateSession(id, { metadata: { ...getSession(id).metadata, configOptions: result.configOptions } });
  } else await state.connection.setModel({ sessionId: session.acp_session_id!, modelId: model });
  updateSession(id, { model });
}
// What the previous agent reported about itself; the new one fills these in when it starts.
const AGENT_OWN_METADATA = ['configOptions', 'modes', 'models', 'preferredMode', 'preferredConfig', 'reasoningEffort', 'agentCapabilities', 'authMethods', 'agentInfo', 'protocolVersion'];
/** Hands the chat to another agent: the old process stops, the new one starts and gets the conversation with the next message. */
export async function switchAgent(id: string, agentId: string): Promise<void> {
  const session = getSession(id);
  if (session.agent_id === agentId) return;
  const agent = getAgent(agentId);
  if (!agent) throw new Error('Агент не найден');
  if (live.get(id)?.busy || starting.has(id) || ['thinking', 'starting', 'waiting'].includes(session.status)) throw new Error('Дождитесь окончания хода');
  await closeSession(id);
  const kept = Object.fromEntries(Object.entries(getSession(id).metadata).filter(([key]) => !AGENT_OWN_METADATA.includes(key)));
  const hasHistory = history(id).some(e => e.type === 'user' || e.type === 'assistant');
  updateSession(id, { agent_id: agentId, model: agent.model, acp_session_id: null, status: 'ready', reason: '', metadata: { ...kept, briefed: false, needsContext: hasHistory } });
  // Nothing to say before the first message: the choice is visible in the bar.
  if (hasHistory) addEvent(id, 'notice', { text: `Агент сменён на «${agent.name}». История чата уйдёт ему со следующим сообщением.` });
  // Starting now fills the new agent's models and modes into the settings bar.
  void startSession(id).catch(() => {});
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
  const result = await state.connection.setConfig({ sessionId: session.acp_session_id, configId, value });
  if (result?.configOptions) updateSession(id, { metadata: { ...getSession(id).metadata, configOptions: result.configOptions } });
}
export async function setMode(id: string, modeId: string): Promise<void> {
  if (isBypassMode(modeId)) throw new Error('Этот режим недоступен: он отключает запросы разрешений');
  const session = getSession(id);
  updateSession(id, { metadata: { ...session.metadata, preferredMode: modeId } });
  const state = live.get(id);
  if (state && !state.loading && !starting.has(id) && session.acp_session_id) {
    await applyMode(id, state, modeId);
  }
  rememberMode(id, modeId); // otherwise applied when the session next starts
}
export async function enableExecution(id: string, policy: PermissionPolicy = 'allow-all'): Promise<void> {
  const state = await startSession(id);
  if (state.busy) throw new Error('Дождитесь окончания обсуждения');
  const session = getSession(id);
  const modes = availableModeIds(session.metadata);
  const mode = selectSessionMode(modes, policy);
  if (mode) await applyMode(id, state, mode);
  updateSession(id, { policy, status: 'ready', reason: '', metadata: { ...getSession(id).metadata, preferredMode: mode } });
}
export async function sendPrompt(id: string, content: ACP.ContentBlock[], gitForTurn = false): Promise<void> {
  const state = await startSession(id);
  if (state.busy) { enqueue(id, JSON.stringify(gitForTurn ? { content, gitForTurn: true } : content)); broadcast({ type: 'agent_queue', sessionId: id }); return; }
  state.busy = true;
  state.cancelled = false;
  state.gitForTurn = gitForTurn;
  state.turnId = randomUUID();
  state.turnAbort = new AbortController();
  const session = getSession(id);
  const text = content.filter(c => c.type === 'text').map(c => (c as ACP.TextContent).text).join('\n');
  updateSession(id, { status: 'thinking', reason: '', ...(session.title === 'Новый чат' && !['manual', 'custom', 'agent'].includes(String(session.metadata.titleSource)) ? { title: text.slice(0, 60) || 'Вложение' } : {}) });
  sessionSignals.emit('thinking', id);
  // `briefing` is Plangent's instructions for the session: sent with the first message (and again if the
  // agent lost the conversation) but never shown as something the developer wrote.
  // Reference sources enter any session only through an explicit developer @mention.
  const project = getProject(session.project_id);
  const workspace = project ? workspaceBriefing(project, await moduleDependencies.workspaces.rootForSession(session)) : '';
  const task = session.task_id ? moduleDependencies.tasks.getTask(session.task_id) : null;
  const authoredSections = task ? moduleDependencies.preparation.listAnalysisSections(task.id).filter(section => section.author === 'developer') : [];
  const referenceRequest = [text, task?.title, task?.description,
    ...authoredSections.flatMap(section => [section.title, section.description])].filter(Boolean).join('\n');
  const references = project ? mentionedReferences(project, referenceRequest) : '';
  const roleBriefing = session.role === 'code-fixer' ? buildCodeFixerBriefing(session.project_id)
    : session.role === 'librarian' ? moduleDependencies.preparation.buildLibrarianPrompt(project?.name ?? session.project_id) + (session.metadata.library_scope === 'global' ? '\nThis chat was opened from global settings. Read and propose GLOBAL library items only. The project is provided for code context; do not edit project or group instructions.' : '') : '';
  const hasGitTools = ['chat', 'task-chat', 'errand'].includes(session.role) && project?.kind === 'project' && !session.metadata.branch_review && !session.metadata.mr_private;
  const gitBriefing = hasGitTools
    ? 'Do not run git commands that modify the repository. For Git actions requested by the developer, use the Plangent git_action tool. Do not add agent attribution to commit messages or pull requests.'
    : 'Do not commit or run git commands that modify the repository. The user makes commits through Plangent. Do not add agent attribution to commit messages or pull requests.';
  const briefing = [gitBriefing, workspace, roleBriefing || (typeof session.metadata.briefing === 'string' ? session.metadata.briefing : '')].filter(Boolean).join('\n\n');
  const withBriefing = briefing && (!session.metadata.briefed || session.metadata.needsContext || hasGitTools && session.metadata.gitToolsBriefingVersion !== 1
    || session.metadata.workspaceBriefingVersion !== WORKSPACE_BRIEFING_VERSION);
  const sectionBriefing = session.role === 'librarian' ? librarianSectionBriefing(session.metadata) : '';
  const prompt: ACP.ContentBlock[] = [
    ...(withBriefing ? [{ type: 'text' as const, text: briefing }] : []),
    ...(sectionBriefing ? [{ type: 'text' as const, text: sectionBriefing }] : []),
    ...(references ? [{ type: 'text' as const, text: references }] : []),
    ...(session.metadata.needsContext ? [{ type: 'text' as const, text: `Previous conversation context (may be truncated):\n${transcript(id)}\n\nNew message:` }] : []),
    ...commandPrompt(session, content),
  ];
  if (session.metadata.needsContext || withBriefing) updateSession(id, { metadata: { ...getSession(id).metadata, needsContext: false,
    ...(briefing ? { briefed: true, workspaceBriefingVersion: WORKSPACE_BRIEFING_VERSION, ...(hasGitTools ? { gitToolsBriefingVersion: 1 } : {}) } : {}) } });
  addEvent(id, 'user', { content, text, ...(withBriefing ? { briefing: true } : {}) });
  void state.connection.prompt({ sessionId: session.acp_session_id!, prompt }).then(result => {
    flush(id, state);
    addEvent(id, 'turn_end', { stopReason: result.stopReason });
    const latest = getSession(id);
    // A session being shut down is not "waiting": whoever closes it sets the final status.
    if (latest.status === 'thinking' && !state.stopping) updateSession(id, { status: latest.role === 'executor' ? 'waiting' : 'ready',
      reason: latest.role === 'executor' ? (latest.policy === 'read-only' ? 'Обсуждение завершено' : 'Агент остановился без отчёта') : '' });
    sessionSignals.emit('turn_end', id);
  }).catch(error => {
    if (!state.stopping) { flush(id, state); updateSession(id, { status: 'error', reason: String(error) }); sessionSignals.emit('error-state', id, String(error)); }
  }).finally(() => {
    state.busy = false;
    state.gitForTurn = false;
    state.turnId = '';
    state.turnAbort?.abort();
    state.turnAbort = null;
    for (const [permissionId, pending] of state.permissions) {
      pending.resolve({ outcome: { outcome: 'cancelled' } });
      addEvent(id, 'permission_result', { permissionId, cancelled: true });
    }
    state.permissions.clear();
    state.idleSince = Date.now();
    const next = queuedPrompts(id)[0];
    if (next && !state.cancelled && !state.stopping && getSession(id).status === 'ready') {
      editQueued(id, next.id);
      broadcast({ type: 'agent_queue', sessionId: id });
      const queued = JSON.parse(next.content) as ACP.ContentBlock[] | { content: ACP.ContentBlock[]; gitForTurn: boolean };
      void sendPrompt(id, Array.isArray(queued) ? queued : queued.content, !Array.isArray(queued) && queued.gitForTurn === true).catch(error => updateSession(id, { status: 'error', reason: String(error) }));
    }
  });
}
export async function cancelSession(id: string): Promise<void> {
  const state = live.get(id);
  if (!state) {
    // Nothing runs behind a "busy" status (the process died or the app restarted): stopping just clears it.
    const session = getSession(id);
    const stale = ['starting', 'thinking', ...(session.role === 'code-fixer' ? ['waiting'] : [])];
    if (!starting.has(id) && stale.includes(session.status)) updateSession(id, { status: 'ready', reason: '' });
    return;
  }
  state.cancelled = true;
  state.turnAbort?.abort();
  for (const [permissionId, pending] of state.permissions) {
    pending.resolve({ outcome: { outcome: 'cancelled' } });
    addEvent(id, 'permission_result', { permissionId, cancelled: true });
  }
  state.permissions.clear();
  await state.connection.cancel({ sessionId: getSession(id).acp_session_id! });
}
export async function closeSession(id: string): Promise<void> {
  const state = live.get(id);
  if (!state) { await stoppingProcesses.get(id); return; }
  await cancelSession(id).catch(() => {});
  state.stopping = true;
  flush(id, state);
  state.connection.close();
  await terminate(state.process.pid);
  live.delete(id);
}
export async function shutdownSessions(): Promise<void> {
  await Promise.all([...live.keys()].map(closeSession));
  await Promise.all(stoppingProcesses.values());
}
/** Reclaim idle processes for every adapter. Owners explicitly mark finished short-lived work. */
export function stopIdleSessions(now = Date.now()): void {
  const stop = (id: string, state: LiveSession) => {
    state.stopping = true;
    live.delete(id);
    state.connection.close();
    const stopped = terminate(state.process.pid)
      .catch(error => console.error('[agents] idle stop failed:', error))
      .finally(() => { if (stoppingProcesses.get(id) === stopped) stoppingProcesses.delete(id); });
    stoppingProcesses.set(id, stopped);
  };
  for (const [id, state] of live) {
    if (state.stopping) continue;
    let session: AgentSession;
    try { session = getSession(id); }
    catch { stop(id, state); continue; } // A deleted chat must not leave an orphan process or break the timer.
    if (state.busy || state.loading || state.stopping || state.permissions.size || starting.has(id) || queuedPrompts(id).length) {
      state.idleSince = now;
      continue;
    }
    if (now >= idleDeadline(session, state.idleSince)) {
      // Leaves `live` right away, so a message arriving meanwhile starts a fresh process instead of this dying one.
      stop(id, state);
    }
  }
}
setInterval(stopIdleSessions, 1_000).unref();
export function sessionAvailability(id: string) {
  const session = getSession(id), state = live.get(id);
  const busy = ['starting', 'thinking', 'waiting'].includes(session.status) || !!(state?.busy || state?.loading || state?.stopping);
  const capabilities = session.metadata.agentCapabilities as { loadSession?: boolean } | undefined;
  const resumable = !!state || !session.acp_session_id || !!capabilities?.loadSession;
  return { busy, resumable, available: !busy };
}
export function snapshot(id: string) {
  const state = live.get(id);
  return { session: getSession(id), commands: sessionCommands(getSession(id)), queue: queuedPrompts(id), streaming: state ? { text: state.text, type: state.textType } : null,
    permissions: state ? [...state.permissions].map(([permissionId, p]) => ({ permissionId, ...p.request })) : [] };
}
