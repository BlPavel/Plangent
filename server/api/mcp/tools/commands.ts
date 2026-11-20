import { runSessionCommand, readSessionCommandOutput, type AgentSession } from '../../../core/agents';
import { defineTools } from './types';

const definitions = {
  run_command: {
    description: 'Run commands that require the project environment and get their exit code and output. Use native file tools or a single plain shell command for file reads, listings and searches. A single read-only Git command may also use the native shell. '
      + 'Mark heavy=true (default) for tests, builds, linters and type checks: heavy commands share a limited number of slots across all agents and may wait in a queue. '
      + 'Mark heavy=false for quick project commands so they start at once. '
      + 'Long output is shortened (start and end kept) and the full log stays available through command_output. Git changes require git_action when available. '
      + `The command runs in the platform shell (${process.platform === 'win32' ? 'cmd.exe on Windows' : 'sh'}).`,
    fields: {
      command: { type: 'string', description: 'The command line.' },
      heavy: { type: 'boolean', description: 'true (default): wait for a free slot; false: run immediately.' },
      cwd: { type: 'string', description: 'Folder to run in, relative to the session folder. Default: the session folder.' },
      timeout_seconds: { type: 'number', description: 'Stop the command after this long. Default 600, at most 3600.' },
    },
  },
  command_output: {
    description: 'Read more of the output of an earlier run_command, by its commandId: lines matching a regular expression (grep) or a range of lines (from, count).',
    fields: {
      commandId: { type: 'string' },
      grep: { type: 'string', description: 'Case-insensitive regular expression; returns matching lines with their numbers.' },
      from: { type: 'number', description: 'First line (1-based) when no grep is given. Default 1.' },
      count: { type: 'number', description: 'Number of lines when no grep is given. Default 200.' },
    },
  },
};

export const tools = defineTools(definitions, {
  run_command: { roles: { chat: 1, 'task-chat': 6, errand: 7, executor: 4, 'code-fixer': 3 }, required: ['command'], validateStrings: ['command'] },
  command_output: { roles: { chat: 2, 'task-chat': 7, errand: 8, executor: 5, 'code-fixer': 4 }, required: ['commandId'], validateStrings: ['commandId'] },
}, async (name, session: AgentSession, args) => name === 'run_command' ? runSessionCommand(session, args) : readSessionCommandOutput(session, args));
