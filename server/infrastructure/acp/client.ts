import type * as ACP from '@agentclientprotocol/sdk';
import { Readable, Writable } from 'stream';
import type { startAdapter } from './process';

const loadSdk = new Function('return import("@agentclientprotocol/sdk")') as () => Promise<typeof ACP>;
export async function connectAdapter(child: ReturnType<typeof startAdapter>, callbacks: {
  update: (event: ACP.SessionNotification) => void;
  permission: (request: ACP.RequestPermissionRequest) => Promise<ACP.RequestPermissionResponse>;
}) {
  const sdk = await loadSdk();
  const connection = sdk.client({ name: 'Plangent' })
    .onNotification('session/update', p => callbacks.update(p.params))
    .onRequest('session/request_permission', p => callbacks.permission(p.params))
    .connect(sdk.ndJsonStream(Writable.toWeb(child.stdin!) as WritableStream<Uint8Array>, Readable.toWeb(child.stdout!) as ReadableStream<Uint8Array>));
  return {
    closed: connection.closed,
    close: () => connection.close(),
    initialize: (version: string) => connection.agent.request('initialize', { protocolVersion: sdk.PROTOCOL_VERSION, clientInfo: { name: 'Plangent', version }, clientCapabilities: {} }),
    newSession: (params: ACP.NewSessionRequest) => connection.agent.request('session/new', params),
    loadSession: (params: ACP.LoadSessionRequest) => connection.agent.request('session/load', params),
    closeSession: (params: { sessionId: string }) => connection.agent.request('session/close', params),
    setConfig: (params: ACP.SetSessionConfigOptionRequest) => connection.agent.request('session/set_config_option', params),
    setMode: (params: ACP.SetSessionModeRequest) => connection.agent.request('session/set_mode', params),
    setModel: (params: { sessionId: string; modelId: string }) => connection.agent.request('session/set_model', params),
    prompt: (params: ACP.PromptRequest) => connection.agent.request('session/prompt', params),
    cancel: (params: ACP.CancelNotification) => connection.agent.notify('session/cancel', params),
  };
}
export type AdapterConnection = Awaited<ReturnType<typeof connectAdapter>>;
