import path from 'path';
import fs from 'node:fs';
import type { RequestPermissionRequest } from '@agentclientprotocol/sdk';
import type { PermissionPolicy } from './types';
import { isPlangentToolCall } from './plangent-tools';
import { isInside } from '../shared/paths';

export const dangerousCommands = ['git push --force', 'git reset --hard', 'rm -rf', 'git clean -fd'];

/** Shell input only: edited prose and diffs are not executable commands.
 * Unknown git subcommands, including aliases, are refused conservatively.
 */
function shellGitDecision(tool: RequestPermissionRequest['toolCall']): 'allow' | 'deny' | undefined {
  if (!['execute', 'other'].includes(tool.kind ?? 'other')) return;
  let found = false;
  for (const text of toolStrings({ title: tool.title, input: tool.rawInput })) {
    const tokens = (text.match(/"[^"\n]*"|'[^'\n]*'|[^\s;&|()]+/g) ?? []).map(t => t.replace(/^["']|["']$/g, '')).flatMap(t => /\s/.test(t) && !/(?:^|[/\\])git(?:\.exe)?$/i.test(t) ? t.split(/\s+/) : [t]);
    for (let i = 0; i < tokens.length; i++) {
      if (!/(?:^|[/\\])git(?:\.exe)?$/i.test(tokens[i])) continue;
      found = true;
      let j = i + 1;
      while (tokens[j]?.startsWith('-')) {
        const option = tokens[j++];
        if (['-C', '--git-dir', '--work-tree', '--namespace'].includes(option)) j++;
        else if (!/^(?:--(?:git-dir|work-tree|namespace)=|--literal-pathspecs$|--no-pager$|--no-optional-locks$)/.test(option)) return 'deny';
      }
      if (!['status', 'diff', 'log', 'show', 'blame', 'grep'].includes(tokens[j] ?? '')) return 'deny';
      if (tokens.slice(j + 1).some(t => /^(?:--output(?:=|$)|--ext-diff$|--textconv$)/.test(t))) return 'deny';
    }
  }
  return found ? 'allow' : undefined;
}

/** Files a tool call would touch, as the agent reported them (locations and diffs). */
function touchedPaths(tool: RequestPermissionRequest['toolCall']): string[] {
  const fromContent = (tool.content ?? []).flatMap(c => (c.type === 'diff' ? [c.path] : []));
  return [...(tool.locations ?? []).map(l => l.path), ...fromContent].filter(Boolean);
}
/** Resolve existing ancestors too, so a new file under an external junction is outside the scope. */
function physicalPath(file: string): string {
  let parent = file;
  while (!fs.existsSync(parent)) {
    const next = path.dirname(parent);
    if (next === parent) return file;
    parent = next;
  }
  return path.resolve(fs.realpathSync(parent), path.relative(parent, file));
}
function toolStrings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (value && typeof value === 'object') return Object.values(value).flatMap(toolStrings);
  return [];
}
/** Where the session may write: `writable[0]` is its working folder (relative paths resolve against it); `files` narrows writes to these files. */
export interface FolderScope { writable: string[]; readOnly?: string[]; files?: string[] }
const samePath = (a: string, b: string) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;

/**
 * How Plangent answers an agent's permission request. Automatic approval covers edits inside the
 * writable folders only, so a mistyped absolute path goes to the developer; reference sources are
 * read-only and edits there are refused.
 */
export function permissionDecision(policy: PermissionPolicy, request: RequestPermissionRequest, dangerous = dangerousCommands, scope?: FolderScope, role?: string): 'allow' | 'deny' | 'ask' {
  const tool = request.toolCall;
  if (isPlangentToolCall(tool)) return 'allow';
  const gitDecision = shellGitDecision(tool);
  if (gitDecision === 'deny') return 'deny';
  // The conflict resolver reads, runs read-only git and edits only the conflicted files; it never asks the developer.
  if (role === 'conflict-resolver') {
    if (gitDecision === 'allow' || ['read', 'search', 'think'].includes(tool.kind ?? '')) return 'allow';
    const writes = ['edit', 'delete', 'move'].includes(tool.kind ?? '') || (tool.content ?? []).some(c => c.type === 'diff');
    if (!writes || tool.kind === 'delete' || tool.kind === 'move') return 'deny';
    const files = touchedPaths(tool), root = scope?.writable[0];
    if (!root || !scope?.files?.length || !files.length) return 'deny';
    try {
      const allowed = scope.files.map(physicalPath);
      return files.every(file => allowed.some(target => samePath(target, physicalPath(path.resolve(root, file))))) ? 'allow' : 'deny';
    } catch { return 'deny'; }
  }
  if (role === 'code-fixer') {
    const writes = ['edit', 'delete', 'move'].includes(tool.kind ?? '') || (tool.content ?? []).some(c => c.type === 'diff');
    if (writes) {
      const files = touchedPaths(tool);
      if (!scope?.writable.length || !files.length) return 'deny';
      try {
        if (files.some(file => !isInside(scope.writable[0], path.resolve(scope.writable[0], file))
          || !isInside(physicalPath(scope.writable[0]), physicalPath(path.resolve(scope.writable[0], file))))) return 'deny';
      } catch { return 'deny'; }
    }
  }
  if (policy === 'read-only') return ['read', 'search', 'think'].includes(tool.kind ?? '') ? 'allow' : 'deny';
  const text = JSON.stringify(tool).toLowerCase();
  if (dangerous.some(command => text.includes(command.toLowerCase())) ||
      /git\s+push\b.*(?:--force|-f\b)|git\s+clean\b.*-[a-z]*[fd]|\brm\s+.*-[a-z]*r[a-z]*f|remove-item.*-recurse/i.test(text)) return 'ask';
  const writes = ['edit', 'delete', 'move'].includes(tool.kind ?? '') || (tool.content ?? []).some(c => c.type === 'diff');
  if (writes && scope?.writable.length) {
    const files = touchedPaths(tool).map(file => path.resolve(scope.writable[0], file));
    if (files.some(file => scope.readOnly?.some(root => isInside(root, file)))) return 'deny';
    if (files.some(file => !scope.writable.some(root => isInside(root, file)))) return 'ask';
  }
  if (policy === 'allow-all') return 'allow';
  if (policy === 'allow-edits' && ['read', 'search', 'edit', 'think'].includes(tool.kind ?? '')) return 'allow';
  return 'ask';
}
