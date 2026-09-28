import path from 'path';
import type { RequestPermissionRequest } from '@agentclientprotocol/sdk';
import type { PermissionPolicy } from './types';
import { isPlangentToolCall } from './plangent-tools';

export const dangerousCommands = ['git push --force', 'git reset --hard', 'rm -rf', 'git clean -fd'];

/** Files a tool call would touch, as the agent reported them (locations and diffs). */
function touchedPaths(tool: RequestPermissionRequest['toolCall']): string[] {
  const fromContent = (tool.content ?? []).flatMap(c => (c.type === 'diff' ? [c.path] : []));
  return [...(tool.locations ?? []).map(l => l.path), ...fromContent].filter(Boolean);
}
function inside(root: string, file: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(root, file));
  return !relative.startsWith('..') && !path.isAbsolute(relative);
}

/**
 * How Plangent answers an agent's permission request. `root` is the project folder: automatic
 * approval covers edits inside it only, so a mistyped absolute path goes to the developer.
 */
export function permissionDecision(policy: PermissionPolicy, request: RequestPermissionRequest, dangerous = dangerousCommands, root?: string): 'allow' | 'deny' | 'ask' {
  const tool = request.toolCall;
  if (isPlangentToolCall(tool)) return 'allow';
  if (policy === 'read-only') return ['read', 'search', 'think'].includes(tool.kind ?? '') ? 'allow' : 'deny';
  const text = JSON.stringify(tool).toLowerCase();
  if (dangerous.some(command => text.includes(command.toLowerCase())) ||
      /git\s+push\b.*(?:--force|-f\b)|git\s+clean\b.*-[a-z]*[fd]|\brm\s+.*-[a-z]*r[a-z]*f|remove-item.*-recurse/i.test(text)) return 'ask';
  const writes = ['edit', 'delete', 'move'].includes(tool.kind ?? '') || (tool.content ?? []).some(c => c.type === 'diff');
  if (writes && root && touchedPaths(tool).some(file => !inside(root, file))) return 'ask';
  if (policy === 'allow-all') return 'allow';
  if (policy === 'allow-edits' && ['read', 'search', 'edit', 'think'].includes(tool.kind ?? '')) return 'allow';
  return 'ask';
}
