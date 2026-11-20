import path from 'path';
import fs from 'node:fs';
import type { RequestPermissionRequest } from '../../../infrastructure/acp/types';
import type { AgentSession, PermissionPolicy } from './types';
type ToolCall = RequestPermissionRequest['toolCall'];
let isApplicationToolCall: (tool: ToolCall) => boolean = () => false;
export function configureApplicationTools(recognize: (tool: ToolCall) => boolean): void { isApplicationToolCall = recognize; }
let toolAvailable: (session: AgentSession, tool: 'run_command' | 'git_action') => boolean = () => false;
export function configureSessionToolAvailability(available: typeof toolAvailable): void { toolAvailable = available; }
export const commandToolAvailable = (session: AgentSession) => toolAvailable(session, 'run_command');
const NATIVE_READ_GUIDANCE = 'Use native file tools or a single plain shell command for file reads, listings and searches. A single read-only Git command such as git status or git diff may also use the native shell.';
export const COMMAND_REDIRECT_REASON = NATIVE_READ_GUIDANCE + " For simple native shell writes use Set-Content or Add-Content with -LiteralPath and -Value, or New-Item -Path with -ItemType File and optional -Value. Use a single command, an absolute path and single-quoted literals. Use native editing tools for other file changes when supported. Run tests, builds, linters and type checks through Plangent run_command with heavy: true. Use run_command for other shell commands. If native execution was refused because of routing, continue through the appropriate permitted tool.";
export function gitToolGuidance(session: AgentSession): string {
  return toolAvailable(session, 'git_action')
    ? 'Use Plangent git_action for Git changes and publishing. If an action is cancelled, stop that operation and report it.'
    : 'Plangent git_action is unavailable in this session. Leave repository changes to the developer or the applicable Plangent workflow.';
}
export function commandBriefing(session: AgentSession): string {
  const commands = session.policy !== 'read-only' && commandToolAvailable(session)
    ? COMMAND_REDIRECT_REASON
    : NATIVE_READ_GUIDANCE;
  return [
    commands,
    'Never use shell commands for Git changes.',
    gitToolGuidance(session),
    'After a tool failure, check the reason. If the tool was unsuitable or the call was malformed, continue with the correct available tool or arguments. Respect denied permissions and cancelled approvals. Continue independent work and report the specific blocker if the requested operation cannot proceed.',
  ].join('\n');
}
import { isInside } from '../../shared';

export const dangerousCommands = ['git push --force', 'git reset --hard', 'rm -rf', 'git clean -fd'];

/** Shell input only: edited prose and diffs are not executable commands.
 * Unknown git subcommands, including aliases, are refused conservatively.
 */
export function shellGitDecision(tool: RequestPermissionRequest['toolCall']): 'allow' | 'deny' | undefined {
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
      const command = tokens[j] ?? '';
      const args = tokens.slice(j + 1);
      const readOnly = ['status', 'diff', 'log', 'show', 'blame', 'grep', 'rev-parse', 'rev-list', 'ls-files', 'ls-tree', 'cat-file', 'merge-base', 'describe', 'shortlog', 'name-rev', 'for-each-ref', 'show-ref'];
      if (!readOnly.includes(command)) {
        const flagsOnly = (allowed: string[]) => args.every(arg => allowed.includes(arg));
        const safe = command === 'branch' ? flagsOnly(['-a', '-r', '-v', '-vv', '--all', '--remotes', '--list', '--verbose', '--show-current', '--no-color'])
          : command === 'tag' ? flagsOnly(['-l', '--list', '-n', '--no-color'])
          : command === 'remote' ? flagsOnly(['-v', '--verbose']) || args.length === 2 && ['show', 'get-url'].includes(args[0]) && /^[\w.][\w.-]*$/.test(args[1])
          : command === 'stash' ? args.length === 1 && ['list', 'show'].includes(args[0])
          : command === 'worktree' ? args.length === 1 && args[0] === 'list'
          : command === 'reflog' ? args.length === 0 || (args.length === 1 && args[0] === 'show')
          : command === 'config' ? args.length === 1 && args[0] === '--list' || args.length === 2 && args[0] === '--get' && !args[1].startsWith('-')
          : false;
        if (!safe) return 'deny';
      }
      if (tokens.slice(j + 1).some(t => /^(?:--output(?:=|$)|--ext-diff$|--textconv$|--filters$)/.test(t))) return 'deny';
      if (command === 'grep' && args.some(t => /^-O|^--open-files-in-pager(?:=|$)/.test(t))) return 'deny';
    }
  }
  return found ? 'allow' : undefined;
}

const readUtilities = /^(?:cat|type|head|tail|ls|dir|tree|pwd|wc|rg|grep|findstr|get-content|gc|get-childitem|gci|select-string|sls|get-item|test-path|get-location)$/i;
const shellWrapper = /^(?:"[^"]*[\\/])?(?:powershell|pwsh)(?:\.exe)?"?(?:\s+-\w+(?:\s+(?:Bypass|Unrestricted|RemoteSigned|Default))?)*\s+-c(?:ommand)?\s+([\s\S]+)$/i;
/**
 * One plain file-reading, listing or searching command (optionally wrapped in `powershell -Command`).
 * Agents without a native read tool read files through their shell; this is not command execution
 * for run_command's purposes. Operators, redirection, expansion and options that run or follow
 * anything are not plain.
 */
export function isPlainReadCommand(command: unknown): boolean {
  const joined = Array.isArray(command) && command.every(part => typeof part === 'string') ? command.join(' ') : command;
  if (typeof joined !== 'string') return false;
  let text = joined.trim();
  const wrapped = shellWrapper.exec(text)?.[1].trim();
  if (wrapped !== undefined) text = /^"[^"]*"$|^'[^']*'$/.test(wrapped) ? wrapped.slice(1, -1) : wrapped;
  if (!/^[\w .,:@=+*?[\]\\/'"-]+$/.test(text)) return false;
  const tokens = (text.match(/"[^"\n]*"|'[^'\n]*'|\S+/g) ?? []).map(t => t.replace(/^["']|["']$/g, ''));
  if (!tokens.length || !readUtilities.test(tokens[0])) return false;
  return !tokens.slice(1).some(t => /^--pre(?:-glob)?(?:=|$)|^--follow$|^-f$|^-wait$/i.test(t));
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
export interface FolderScope { writable: string[]; readOnly?: string[]; files?: string[]; restrictWrites?: boolean }
const samePath = (a: string, b: string) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;

// Accept only one text-file cmdlet with literal arguments. An absolute path avoids
// relying on the adapter's working directory.
export function plainFileWritePath(command: unknown): string | undefined {
  if (typeof command !== 'string' || /[\x00-\x1f\x7f%"\x60\u2018-\u201f]/.test(command)) return;
  const text = command.trim();
  const file = /^(?:Set|Add)-Content +\-LiteralPath +'([^']+)' +\-Value +'[^']*'(?: +\-Encoding +utf8)?$/i.exec(text)?.[1]
    ?? /^New-Item +\-Path +'([^']+)' +\-ItemType +File(?: +\-Value +'[^']*')?$/i.exec(text)?.[1];
  return file;
}

function canWriteShellFile(file: string, scope?: FolderScope): boolean {
  if (!scope?.writable.length || !path.isAbsolute(file) || /^[\\/]{2}/.test(file)) return false;
  if (process.platform === 'win32' && !/^[A-Za-z]:[\\/]/.test(file)) return false;
  const localPath = process.platform === 'win32' ? file.replace(/^[A-Za-z]:/, '') : file;
  const segments = localPath.split(/[\\/]/).filter(Boolean);
  if (segments.some(segment => /[:*?\[\]<>|]|[. ]$|^(?:con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(?:\.|$)/i.test(segment))) return false;
  try {
    const target = path.resolve(file);
    const parent = fs.realpathSync(path.dirname(target));
    const physical = path.join(parent, path.basename(target));
    const existing = fs.lstatSync(target, { throwIfNoEntry: false });
    if (existing && (!existing.isFile() || existing.nlink !== 1)) return false;
    const protectedPath = (value: string) => /(?:^|[\\/])\.(?:git|agents|codex|aws)(?:[\\/]|$)/i.test(value);
    if ([target, physical].some(protectedPath)) return false;
    if (scope.readOnly?.some(root => isInside(root, target) || isInside(physicalPath(root), physical))) return false;
    return scope.writable.some(root => !samePath(root, target) && isInside(root, target) && isInside(physicalPath(root), physical));
  } catch { return false; }
}

/**
 * How Plangent answers an agent's permission request. Automatic approval covers edits inside the
 * writable folders only, so a mistyped absolute path goes to the developer; reference sources are
 * read-only and edits there are refused.
 */
export function permissionDecision(policy: PermissionPolicy, request: RequestPermissionRequest, dangerous = dangerousCommands, scope?: FolderScope, role?: string, redirectCommands = false): 'allow' | 'deny' | 'ask' {
  const tool = request.toolCall;
  const raw = tool.rawInput as { command?: unknown } | undefined;
  if (tool.kind === 'execute' && typeof raw?.command === 'string' && shellGitDecision({ ...tool, title: '', rawInput: { command: raw.command } }) === 'deny') return 'deny';
  if (isApplicationToolCall(tool)) return 'allow';
  const gitDecision = shellGitDecision(tool);
  if (gitDecision === 'deny') return 'deny';
  // Auto-approve only a single, literal git invocation. Shell operators, expansions, quoting and
  // wrappers require the ordinary policy because they may execute additional commands.
  const command = raw && typeof raw === 'object' && Object.keys(raw).every(key => key === 'command') ? raw.command : undefined;
  if (gitDecision === 'allow' && tool.kind === 'execute' && typeof command === 'string'
      && /^git(?:[ \t]+[A-Za-z0-9_./:@=+\-]+)*[ \t]*$/.test(command)) return 'allow';
  if (tool.kind === 'execute' && raw && typeof raw === 'object' && isPlainReadCommand(raw.command)) return 'allow';
  if (tool.kind === 'execute' && typeof raw?.command === 'string') {
    const shellCommand = raw.command;
    const file = plainFileWritePath(shellCommand);
    if (file !== undefined) {
      if (policy === 'read-only' || role === 'conflict-resolver' || role === 'code-fixer' || !canWriteShellFile(file, scope)) return 'deny';
      if (dangerous.some(rule => shellCommand.toLowerCase().includes(rule.toLowerCase()))) return 'ask';
      return policy === 'ask' ? 'ask' : 'allow';
    }
  }
  if (redirectCommands && tool.kind === 'execute') return 'deny';
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
    if (scope.restrictWrites) {
      if (!files.length) return 'deny';
      try {
        if (files.some(file => !scope.writable.some(root => isInside(root, file) && isInside(physicalPath(root), physicalPath(file))))) return 'deny';
      } catch { return 'deny'; }
    }
    if (files.some(file => scope.readOnly?.some(root => isInside(root, file)))) return 'deny';
    if (files.some(file => !scope.writable.some(root => isInside(root, file)))) return 'ask';
  }
  if (policy === 'allow-all') return 'allow';
  if (policy === 'allow-edits' && ['read', 'search', 'edit', 'think'].includes(tool.kind ?? '')) return 'allow';
  return 'ask';
}
