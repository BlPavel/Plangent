import type { GitSettings } from '@contracts';
export type { GitSettings } from '@contracts';

export const defaultGitSettings: GitSettings = {
  workspace_copy_files: [], workspace_setup_command: '', auto_review: false,
  commit_pattern: '',
  forbidden_patterns: ['^Co-Authored-By:.*(Claude|anthropic)', 'noreply@anthropic\\.com', 'Generated with \\[?Claude Code', '🤖 Generated with'],
  include_description: false, finish_scenario: 'nothing', branch_prefixes: ['feature', 'fix', 'hotfix'],
  base_branch: '', mr_description_prompt: '', mr_remove_branch: false, mr_squash: false, mr_reviewers: [], mr_assignees: [],
  git_agent_id: '', git_agent_model: '', git_agent_effort: '',
  review_agent_id: '', review_agent_model: '', review_agent_effort: '', review_agent_policy: '',
  conflict_agent_id: '', conflict_agent_model: '', conflict_agent_effort: '',
};

/** A group has no repository: the base branch and the people on merge requests are each project's own. */
const PROJECT_ONLY: (keyof GitSettings)[] = ['base_branch', 'mr_assignees', 'mr_reviewers'];
export function withoutProjectOnly(settings: Partial<GitSettings> = {}): Partial<GitSettings> {
  return Object.fromEntries(Object.entries(settings).filter(([key]) => !PROJECT_ONLY.includes(key as keyof GitSettings)));
}

/** Nearest wins: the project, its group, the app-wide values from «Настройки», the built-in defaults. */
export function resolveGitSettings(groupSettings: Partial<GitSettings> = {}, project: Partial<GitSettings> = {}, global: Partial<GitSettings> = {}) {
  const group = withoutProjectOnly(groupSettings);
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
    if (key === 'review_agent_policy' && !['', 'ask', 'allow-edits', 'allow-all'].includes(item as string)) throw new Error('Invalid review agent policy');
    if (key === 'finish_scenario' && !['nothing', 'commits', 'push', 'full'].includes(item as string)) throw new Error('Invalid finish scenario');
  }
  return settings as Partial<GitSettings>;
}
