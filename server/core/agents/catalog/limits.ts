import { startAdapter, stopAdapter } from '../../../infrastructure/acp/process';
import os from 'os';
import { getAgent } from './index';

import type { Agent } from '../../../models';
import { APP_VERSION } from '../../shared';
import { resolvedAgentEnv, enforceAgentProxy } from '../sessions/env';

// Subscription limits read straight from the agent CLI's own account endpoints. These are account
// reads (what `/usage` and `/status` show), not model calls, so polling costs no tokens or quota.

import type { LimitWindow, AgentLimits } from '@contracts';
export type { LimitWindow, AgentLimits } from '@contracts';

// Each read starts a full agent CLI (~200 MB), so background polls reuse a 5-minute-old value;
// only the refresh after a finished turn (`force`) reads sooner.
const TTL = 5 * 60_000, MIN_GAP = 10_000, TIMEOUT = 25_000;
const cache = new Map<string, { value: Promise<AgentLimits>; at: number }>();

function provider(agent: Agent): 'claude' | 'codex' | null {
  const hint = `${agent.id} ${agent.command}`.toLowerCase();
  return hint.includes('claude') ? 'claude' : hint.includes('codex') ? 'codex' : null;
}

/** Spawns `command args`, writes the given JSON lines and resolves with the first reply `pick` accepts. */
async function rpc<T>(agent: Agent, command: string, args: string[], lines: (reply: Record<string, unknown> | null) => unknown[], pick: (msg: Record<string, unknown>) => T | undefined): Promise<T> {
  const env = await resolvedAgentEnv(agent);
  const launchArgs = agent.use_proxy && provider(agent) === 'claude' && env.HTTPS_PROXY
    ? [...args, '--settings', JSON.stringify({ env: enforceAgentProxy({}, env.HTTPS_PROXY) })]
    : agent.use_proxy && provider(agent) === 'codex'
      ? [...args, '-c', 'features.respect_system_proxy=false', '-c', 'features.system_proxy_fallback=false'] : args;
  return new Promise((resolve, reject) => {
    const child = startAdapter(command, launchArgs, env, false);
    let buffer = '', done = false, stderr = '';
    const finish = (error: Error | null, value?: T) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      void stopAdapter(child.pid);
      if (error) reject(error); else resolve(value as T);
    };
    const write = (messages: unknown[]) => { for (const m of messages) child.stdin!.write(JSON.stringify(m) + '\n'); };
    const timer = setTimeout(() => finish(new Error('CLI не ответил вовремя')), TIMEOUT);
    child.on('error', e => finish(e));
    child.on('exit', code => finish(new Error(`CLI завершился (${code}). ${stderr.slice(-300)}`)));
    child.stderr!.on('data', chunk => { stderr = (stderr + chunk).slice(-2000); });
    child.stdout!.on('data', chunk => {
      buffer += chunk;
      let index;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        let msg: Record<string, unknown>;
        try { msg = JSON.parse(line); } catch { continue; }
        let value: T | undefined;
        try { value = pick(msg); } catch (error) { return finish(error as Error); }
        if (value !== undefined) return finish(null, value);
        write(lines(msg));
      }
    });
    write(lines(null));
  });
}

const CLAUDE_KINDS: Record<string, string> = { session: '5 часов', weekly_all: 'Неделя', weekly_opus: 'Неделя · Opus', weekly_sonnet: 'Неделя · Sonnet' };
interface ClaudeWindow { utilization: number | null; resets_at: string | null }
interface ClaudeUsage { rate_limits?: { limits?: { kind: string; percent: number | null; resets_at: string | null }[]; five_hour?: ClaudeWindow | null; seven_day?: ClaudeWindow | null } | null }

async function claudeLimits(agent: Agent): Promise<LimitWindow[]> {
  // Same control request the Agent SDK sends for `/usage`; --strict-mcp-config keeps user MCP servers from starting.
  const usage = await rpc<ClaudeUsage>(agent, agent.command || 'claude',
    ['--output-format', 'stream-json', '--verbose', '--input-format', 'stream-json', '--strict-mcp-config'],
    msg => {
      if (!msg) return [{ type: 'control_request', request_id: 'init', request: { subtype: 'initialize' } }];
      const response = msg.response as { request_id?: string } | undefined;
      return msg.type === 'control_response' && response?.request_id === 'init'
        ? [{ type: 'control_request', request_id: 'usage', request: { subtype: 'get_usage', skip_behaviors: true } }] : [];
    },
    msg => {
      const response = msg.response as { request_id?: string; subtype?: string; response?: ClaudeUsage; error?: string } | undefined;
      if (msg.type !== 'control_response' || response?.request_id !== 'usage') return undefined;
      if (response.subtype === 'error') throw new Error(response.error ?? 'Claude не отдал лимиты');
      return response.response ?? {};
    });
  const limits = usage.rate_limits;
  const time = (value: string | null) => (value ? Date.parse(value) || null : null);
  if (limits?.limits?.length) {
    return limits.limits.filter(l => l.percent != null)
      .map(l => ({ id: l.kind, label: CLAUDE_KINDS[l.kind] ?? l.kind, percent: l.percent!, resetsAt: time(l.resets_at) }));
  }
  return (['five_hour', 'seven_day'] as const).flatMap(key => {
    const w = limits?.[key];
    return w && w.utilization != null ? [{ id: key, label: key === 'five_hour' ? '5 часов' : 'Неделя', percent: w.utilization, resetsAt: time(w.resets_at) }] : [];
  });
}

interface CodexWindow { usedPercent: number; windowDurationMins?: number | null; resetsAt?: number | null }
interface CodexSnapshot { limitId?: string; limitName?: string | null; primary?: CodexWindow | null; secondary?: CodexWindow | null }

function windowLabel(minutes?: number | null) {
  if (!minutes) return 'Лимит';
  if (minutes === 10080) return 'Неделя';
  if (minutes % 1440 === 0) return `${minutes / 1440} дн`;
  return minutes % 60 === 0 ? `${minutes / 60} часов` : `${minutes} мин`;
}

async function codexLimits(agent: Agent): Promise<LimitWindow[]> {
  const result = await rpc<{ rateLimits?: CodexSnapshot; rateLimitsByLimitId?: Record<string, CodexSnapshot> }>(agent, agent.command || 'codex', ['app-server'],
    msg => {
      if (!msg) return [{ id: 1, method: 'initialize', params: { clientInfo: { name: 'plangent', version: APP_VERSION }, capabilities: null } }];
      return msg.id === 1 ? [{ method: 'initialized' }, { id: 2, method: 'account/rateLimits/read' }] : [];
    },
    msg => {
      if (msg.id !== 2) return undefined;
      if (msg.error) throw new Error((msg.error as { message?: string }).message ?? 'Codex не отдал лимиты');
      return (msg.result ?? {}) as { rateLimits?: CodexSnapshot };
    });
  const snapshots = Object.values(result.rateLimitsByLimitId ?? {}).filter(Boolean);
  if (!snapshots.length && result.rateLimits) snapshots.push(result.rateLimits);
  return snapshots.flatMap(s => (['primary', 'secondary'] as const).flatMap(key => {
    const w = s[key];
    if (!w) return [];
    const label = windowLabel(w.windowDurationMins);
    return [{ id: `${s.limitId ?? 'codex'}:${key}`, label: s.limitName ? `${s.limitName} · ${label}` : label, percent: w.usedPercent, resetsAt: w.resetsAt ? w.resetsAt * 1000 : null }];
  }));
}

async function read(agent: Agent): Promise<AgentLimits> {
  const kind = provider(agent);
  if (!kind) return { agentId: agent.id, at: Date.now(), windows: [], error: 'Лимиты для этого агента недоступны' };
  try {
    const windows = await (kind === 'claude' ? claudeLimits(agent) : codexLimits(agent));
    return { agentId: agent.id, at: Date.now(), windows: windows.map(w => ({ ...w, percent: Math.max(0, Math.min(100, Math.round(w.percent))) })) };
  } catch (error) {
    return { agentId: agent.id, at: Date.now(), windows: [], error: error instanceof Error ? error.message : String(error) };
  }
}

/** Cached per agent; `force` (after a turn) still waits at least MIN_GAP between CLI launches. */
export function agentLimits(agentId: string, force = false): Promise<AgentLimits> {
  const agent = getAgent(agentId);
  if (!agent) return Promise.reject(new Error('Агент не найден'));
  const hit = cache.get(agentId);
  const age = hit ? Date.now() - hit.at : Infinity;
  if (hit && (age < MIN_GAP || (!force && age < TTL))) return hit.value;
  const value = read(agent);
  cache.set(agentId, { value, at: Date.now() });
  return value;
}
