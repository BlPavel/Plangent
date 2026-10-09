export interface GitSettings {
  commit_pattern: string;
  forbidden_patterns: string[];
  include_description: boolean;
  finish_scenario: 'nothing' | 'commits' | 'push' | 'full';
  branch_prefixes: string[];
  base_branch: string;
  mr_description_prompt: string;
  mr_remove_branch: boolean;
  mr_squash: boolean;
  mr_reviewers: string[];
}

export const defaultGitSettings: GitSettings = {
  commit_pattern: '',
  forbidden_patterns: ['^Co-Authored-By:.*(Claude|anthropic)', 'noreply@anthropic\\.com', 'Generated with \\[?Claude Code', '🤖 Generated with'],
  include_description: false, finish_scenario: 'nothing', branch_prefixes: ['feature', 'fix', 'hotfix'],
  base_branch: '', mr_description_prompt: '', mr_remove_branch: false, mr_squash: false, mr_reviewers: [],
};

export function resolveGitSettings(group: Partial<GitSettings> = {}, project: Partial<GitSettings> = {}) {
  const values = { ...defaultGitSettings, ...group, ...project };
  const sources = Object.fromEntries(Object.keys(defaultGitSettings).map(key => [key,
    Object.hasOwn(project, key) ? 'project' : Object.hasOwn(group, key) ? 'group' : 'default']));
  return { values, sources };
}

// Settings that no longer exist: older projects still carry them, so they are dropped instead of rejected.
const LEGACY_KEYS = ['branch_template', 'mr_target_branch', 'mr_description_template', 'mr_labels'];

export function validateGitSettings(value: unknown): Partial<GitSettings> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid git settings');
  const settings = Object.fromEntries(Object.entries(value).filter(([key]) => !LEGACY_KEYS.includes(key)));
  for (const [key, item] of Object.entries(settings)) {
    if (!Object.hasOwn(defaultGitSettings, key)) throw new Error('Unknown git setting: ' + key);
    if (['forbidden_patterns', 'branch_prefixes', 'mr_reviewers'].includes(key)) {
      if (!Array.isArray(item) || item.length > 100 || item.some(p => typeof p !== 'string' || p.length > 1000)) throw new Error('Invalid forbidden patterns');
      if (key === 'forbidden_patterns') for (const pattern of item) new RegExp(pattern, 'im');
    } else if (typeof item !== typeof defaultGitSettings[key as keyof GitSettings]) throw new Error('Invalid git setting: ' + key);
    if (key === 'commit_pattern' && item) new RegExp(item as string, 'm');
    if (key === 'finish_scenario' && !['nothing', 'commits', 'push', 'full'].includes(item as string)) throw new Error('Invalid finish scenario');
  }
  return settings as Partial<GitSettings>;
}
