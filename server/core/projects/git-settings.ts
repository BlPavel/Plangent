export interface GitSettings {
  commit_pattern: string;
  workspace_copy_files: string[];
  workspace_setup_command: string;
  /** Agent review runs by itself when a task's queue or an errand's turn ends; off unless turned on. */
  auto_review: boolean;
  forbidden_patterns: string[];
  include_description: boolean;
  finish_scenario: 'nothing' | 'commits' | 'push' | 'full';
  branch_prefixes: string[];
  base_branch: string;
  mr_description_prompt: string;
  mr_remove_branch: boolean;
  mr_squash: boolean;
  mr_reviewers: string[];
  mr_assignees: string[];
  /** The agent that writes commit messages, splits commits and describes MRs; empty — the project's agent. */
  git_agent_id: string;
  git_agent_model: string;
  git_agent_effort: string;
  /** The agent that reviews merge requests and branches together with the developer; empty — the project's agent. */
  review_agent_id: string;
  review_agent_model: string;
  review_agent_effort: string;
  /** The agent that resolves merge/rebase conflicts; empty — the git agent, then the project's. */
  conflict_agent_id: string;
  conflict_agent_model: string;
  conflict_agent_effort: string;
}

export const defaultGitSettings: GitSettings = {
  workspace_copy_files: [], workspace_setup_command: '', auto_review: false,
  commit_pattern: '',
  forbidden_patterns: ['^Co-Authored-By:.*(Claude|anthropic)', 'noreply@anthropic\\.com', 'Generated with \\[?Claude Code', '🤖 Generated with'],
  include_description: false, finish_scenario: 'nothing', branch_prefixes: ['feature', 'fix', 'hotfix'],
  base_branch: '', mr_description_prompt: '', mr_remove_branch: false, mr_squash: false, mr_reviewers: [], mr_assignees: [],
  git_agent_id: '', git_agent_model: '', git_agent_effort: '',
  review_agent_id: '', review_agent_model: '', review_agent_effort: '',
  conflict_agent_id: '', conflict_agent_model: '', conflict_agent_effort: '',
};

/** Nearest wins: the project, its group, the app-wide values from «Настройки», the built-in defaults. */
export function resolveGitSettings(group: Partial<GitSettings> = {}, project: Partial<GitSettings> = {}, global: Partial<GitSettings> = {}) {
  const values = { ...defaultGitSettings, ...global, ...group, ...project };
  const sources = Object.fromEntries(Object.keys(defaultGitSettings).map(key => [key,
    Object.hasOwn(project, key) ? 'project' : Object.hasOwn(group, key) ? 'group' : Object.hasOwn(global, key) ? 'global' : 'default']));
  return { values, sources };
}

// Settings that no longer exist: older projects still carry them, so they are dropped instead of rejected.
const LEGACY_KEYS = ['branch_template', 'mr_target_branch', 'mr_description_template', 'mr_labels'];

export function validateGitSettings(value: unknown): Partial<GitSettings> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid git settings');
  const settings = Object.fromEntries(Object.entries(value).filter(([key]) => !LEGACY_KEYS.includes(key)));
  for (const [key, item] of Object.entries(settings)) {
    if (!Object.hasOwn(defaultGitSettings, key)) throw new Error('Unknown git setting: ' + key);
    if (['forbidden_patterns', 'branch_prefixes', 'mr_reviewers', 'mr_assignees', 'workspace_copy_files'].includes(key)) {
      if (!Array.isArray(item) || item.length > 100 || item.some(p => typeof p !== 'string' || p.length > 1000)) throw new Error('Invalid forbidden patterns');
      if (key === 'forbidden_patterns') for (const pattern of item) new RegExp(pattern, 'im');
      if (key === 'workspace_copy_files') for (const pattern of item) {
        if (!pattern || pattern.startsWith('/') || /[\\:]/.test(pattern) || pattern.split('/').some((p: string) => p === '..' || p === '.git')) throw new Error('Invalid workspace copy pattern');
      }
    } else if (typeof item !== typeof defaultGitSettings[key as keyof GitSettings]) throw new Error('Invalid git setting: ' + key);
    if (key === 'commit_pattern' && item) new RegExp(item as string, 'm');
    if (key === 'finish_scenario' && !['nothing', 'commits', 'push', 'full'].includes(item as string)) throw new Error('Invalid finish scenario');
  }
  return settings as Partial<GitSettings>;
}
