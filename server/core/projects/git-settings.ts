export interface GitSettings {
  commit_pattern: string;
  forbidden_patterns: string[];
  include_description: boolean;
  finish_scenario: 'nothing' | 'commits' | 'push' | 'full';
  branch_template: string;
  base_branch: string;
  mr_target_branch: string;
  mr_description_template: string;
  mr_remove_branch: boolean;
  mr_squash: boolean;
  mr_reviewers: string[];
  mr_labels: string[];
}

export const defaultGitSettings: GitSettings = {
  commit_pattern: '',
  forbidden_patterns: ['^Co-Authored-By:.*(Claude|anthropic)', 'noreply@anthropic\\.com', 'Generated with \\[?Claude Code', '🤖 Generated with'],
  include_description: false, finish_scenario: 'nothing', branch_template: 'feature/{key}-{slug}',
  base_branch: '', mr_target_branch: '', mr_description_template: '', mr_remove_branch: true, mr_squash: false, mr_reviewers: [], mr_labels: [],
};

export function resolveGitSettings(group: Partial<GitSettings> = {}, project: Partial<GitSettings> = {}) {
  const values = { ...defaultGitSettings, ...group, ...project };
  const sources = Object.fromEntries(Object.keys(defaultGitSettings).map(key => [key,
    Object.hasOwn(project, key) ? 'project' : Object.hasOwn(group, key) ? 'group' : 'default']));
  return { values, sources };
}

export function validateGitSettings(value: unknown): Partial<GitSettings> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid git settings');
  const settings = value as Record<string, unknown>;
  for (const [key, item] of Object.entries(settings)) {
    if (!Object.hasOwn(defaultGitSettings, key)) throw new Error('Unknown git setting: ' + key);
    if (['forbidden_patterns', 'mr_reviewers', 'mr_labels'].includes(key)) {
      if (!Array.isArray(item) || item.length > 100 || item.some(p => typeof p !== 'string' || p.length > 1000)) throw new Error('Invalid forbidden patterns');
      if (key === 'forbidden_patterns') for (const pattern of item) new RegExp(pattern, 'im');
    } else if (typeof item !== typeof defaultGitSettings[key as keyof GitSettings]) throw new Error('Invalid git setting: ' + key);
    if (key === 'commit_pattern' && item) new RegExp(item as string, 'm');
    if (key === 'finish_scenario' && !['nothing', 'commits', 'push', 'full'].includes(item as string)) throw new Error('Invalid finish scenario');
  }
  return value as Partial<GitSettings>;
}
