import type { LayoutProfile } from '../../models';

/**
 * Known agents: how to start their ACP adapter and where they read instructions/skills from.
 * The settings form fills itself from these; agents with other ids work the same once configured by hand.
 */
export interface AgentPreset {
  name: string;
  acp_command: string;
  acp_args: string[];
  command: string;
  update_command: string;
  layout_profile: LayoutProfile | null;
}

export const agentPresets: Record<string, AgentPreset> = {
  claude: {
    name: 'Claude Code',
    acp_command: 'npx',
    acp_args: ['--yes', '@agentclientprotocol/claude-agent-acp@0.81.2'],
    command: 'claude',
    update_command: 'npm update -g @anthropic-ai/claude-code',
    layout_profile: {
      skills: { dir: '.claude/skills', global: '~/.claude/skills', file: 'plangent-<slug>/SKILL.md' },
      commands: { dir: '.claude/commands', global: '~/.claude/commands', file: 'plangent-<slug>.md' },
      main: { file: 'CLAUDE.md', global: '~/.claude/CLAUDE.md' },
    },
  },
  codex: {
    name: 'Codex CLI',
    acp_command: 'npx',
    acp_args: ['--yes', '@agentclientprotocol/codex-acp@1.13.1'],
    command: 'codex',
    update_command: 'npm install -g @openai/codex@latest',
    layout_profile: {
      skills: { dir: '.agents/skills', global: '~/.agents/skills', file: 'plangent-<slug>/SKILL.md' },
      commands: { dir: '.agents/skills', global: '~/.agents/skills', file: 'plangent-<slug>/SKILL.md', asSkill: true },
      main: { file: 'AGENTS.md', global: '~/.codex/AGENTS.md' },
    },
  },
  gemini: {
    name: 'Gemini CLI',
    acp_command: 'gemini',
    acp_args: ['--experimental-acp'],
    command: 'gemini',
    update_command: 'npm install -g @google/gemini-cli@latest',
    layout_profile: { main: { file: 'GEMINI.md', global: '~/.gemini/GEMINI.md' } },
  },
  gigacode: {
    name: 'GigaCode',
    acp_command: 'gigacode',
    acp_args: ['--acp'],
    command: 'gigacode',
    update_command: '',
    layout_profile: {
      skills: { dir: '.gigacode/skills', global: '~/.gigacode/skills', file: 'plangent-<slug>/SKILL.md' },
      commands: { dir: '.gigacode/skills', global: '~/.gigacode/skills', file: 'plangent-<slug>/SKILL.md', asSkill: true },
      main: { file: 'GIGACODE.md', global: '~/.gigacode/GIGACODE.md' },
    },
  },
};

/** Seeded agents predate acp_command; they fall back to their preset's adapter. */
export const presetForAgentId: Record<string, string> = { 'agent-claude': 'claude', 'agent-codex': 'codex' };
