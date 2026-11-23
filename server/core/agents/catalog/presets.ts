import type { AgentPreset } from '../../../models';
export type { AgentPreset } from '../../../models';

/**
 * Known agents: how to start their ACP adapter and where they read instructions/skills from.
 * The settings form fills itself from these; agents with other ids work the same once configured by hand.
 */
export const agentPresets: Record<string, AgentPreset> = {
  claude: {
    name: 'Claude Code',
    acp_command: 'npx',
    acp_args: ['--yes', '@agentclientprotocol/claude-agent-acp@0.108.0'],
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
    acp_args: ['--yes', '@agentclientprotocol/codex-acp@2.7.0'],
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
  qwen: {
    name: 'Qwen Code',
    acp_command: 'qwen',
    acp_args: ['--acp'],
    command: 'qwen',
    update_command: 'npm install -g @qwen-code/qwen-code@latest',
    layout_profile: {
      skills: { dir: '.qwen/skills', global: '~/.qwen/skills', file: 'plangent-<slug>/SKILL.md' },
      commands: { dir: '.qwen/skills', global: '~/.qwen/skills', file: 'plangent-<slug>/SKILL.md', asSkill: true },
      main: { file: 'QWEN.md', global: '~/.qwen/QWEN.md' },
    },
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

// Provider-supported Claude Code integrations also work through its ACP adapter.
// Credentials stay empty: the developer supplies their provider's API key.
function claudeApiPreset(name: string, baseUrl: string, model: string, env: Record<string, string> = {}): AgentPreset {
  return {
    ...agentPresets.claude,
    name,
    command: '', // Claude account limits do not describe third-party API usage.
    update_command: '', // The pinned adapter includes the Claude Agent SDK.
    env: {
      ANTHROPIC_BASE_URL: baseUrl,
      ANTHROPIC_AUTH_TOKEN: '',
      ANTHROPIC_API_KEY: '',
      CLAUDE_CODE_OAUTH_TOKEN: '',
      ANTHROPIC_MODEL: model,
      ANTHROPIC_DEFAULT_OPUS_MODEL: model,
      ANTHROPIC_DEFAULT_SONNET_MODEL: model,
      ANTHROPIC_DEFAULT_HAIKU_MODEL: model,
      ANTHROPIC_DEFAULT_FABLE_MODEL: model,
      CLAUDE_CODE_SUBAGENT_MODEL: model,
      ...env,
    },
  };
}

agentPresets.deepseek = claudeApiPreset('DeepSeek', 'https://api.deepseek.com/anthropic', 'deepseek-flash[1m]', {
  ANTHROPIC_DEFAULT_HAIKU_MODEL: 'deepseek-flash',
  CLAUDE_CODE_SUBAGENT_MODEL: 'deepseek-flash',
  CLAUDE_CODE_AUTO_COMPACT_WINDOW: '786432',
});

// https://docs.z.ai/devpack/tool/claude — use a Z.ai GLM Coding Plan key.
agentPresets.glm = claudeApiPreset('GLM (Z.ai)', 'https://api.z.ai/api/anthropic', 'glm-5.3[1m]', {
  CLAUDE_CODE_AUTO_COMPACT_WINDOW: '1000000',
  CLAUDE_CODE_MAX_CONTEXT_TOKENS: '1000000',
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
  DISABLE_TELEMETRY: '1',
  API_TIMEOUT_MS: '3000000',
});

// https://platform.kimi.ai/docs/guide/claude-code-kimi — Moonshot API billing, not Kimi Code.
agentPresets.kimi = claudeApiPreset('Kimi (Moonshot API)', 'https://api.moonshot.ai/anthropic', 'kimi-k3[1m]', {
  CLAUDE_CODE_AUTO_COMPACT_WINDOW: '1000000',
  CLAUDE_CODE_EFFORT_LEVEL: 'max',
});

// Subscription credentials come from Kimi Code Console and use x-api-key authentication.
// https://www.kimi.com/code/docs/en/third-party-tools/claude-code.html
agentPresets['kimi-code'] = claudeApiPreset('Kimi Code (подписка)', 'https://api.kimi.ai/coding/', 'k3.1-pro', {
  CLAUDE_CODE_EFFORT_LEVEL: 'high',
  CLAUDE_CODE_AUTO_COMPACT_WINDOW: '262144',
  CLAUDE_CODE_MAX_CONTEXT_TOKENS: '262144',
});

/** Seeded agents predate acp_command; they fall back to their preset's adapter. */
export const presetForAgentId: Record<string, string> = { 'agent-claude': 'claude', 'agent-codex': 'codex' };
