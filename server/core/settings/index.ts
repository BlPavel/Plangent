import { moduleDependencies } from './dependencies';
import * as queries from '../../infrastructure/db/repositories/settings/index';
export function readSetting(key: string) {
  const row = queries.rowSelectAppSettings(key) as { value: string; updated_at: string } | undefined;
  return { value: row?.value ?? '', updated_at: row?.updated_at ?? null };
}
export function writeSetting(key: string, value: string): void {
  queries.writeSettingInsertAppSettings(key, value);
}

import type { getProject, ProjectError } from '../projects';
import { DomainError } from '../../models/domain-error';
import { resolveGitSettings, validateGitSettings, type GitSettings } from './git-settings';
export * from './git-settings';
/** Explicit choices take precedence over saved choices, purpose settings and project defaults. */
export function resolveAgentChoice(projectId: string, choices: { explicit?: string | null; saved?: string | null; purpose?: 'git' | 'review' | 'conflict' } = {}) {
  const project = moduleDependencies.projects.getProject(projectId);
  const settings = choices.purpose ? effectiveGitSettings(projectId).values : null;
  const purpose = choices.purpose === 'conflict' && !settings?.conflict_agent_id ? 'git' : choices.purpose;
  const configured = settings && purpose ? settings[`${purpose}_agent_id`] : '';
  const agentId = choices.explicit || choices.saved || configured || project?.default_agent_id || '';
  return { agentId, model: configured === agentId && settings && purpose ? settings[`${purpose}_agent_model`] : '',
    effort: configured === agentId && settings && purpose ? settings[`${purpose}_agent_effort`] : '' };
}
export function effectiveGitSettings(id: string) {
  const project = moduleDependencies.projects.getProject(id);
  if (!project) throw new moduleDependencies.projects.ProjectError('Project not found');
  return resolveGitSettings(project.group_id ? moduleDependencies.projects.getProject(project.group_id)?.git_settings : {}, project.git_settings, globalGitSettings());
}

/** App-wide git settings («Настройки»): the level under every group and project. */
export function globalGitSettings(): Partial<GitSettings> {
  const row = queries.rowSelectAppSettings2() as { value: string } | undefined;
  try { return row ? validateGitSettings(JSON.parse(row.value)) : {}; } catch { return {}; }
}
export function saveGlobalGitSettings(value: unknown) {
  let settings: Partial<GitSettings>;
  try { settings = validateGitSettings(value); } catch (error) { throw new moduleDependencies.projects.ProjectError((error as Error).message); }
  queries.saveGlobalGitSettingsInsertAppSettings(JSON.stringify(settings));
  return settings;
}

/** Who does the git work (commit messages, commit split, MR description): the configured agent, else the project's. */
export function gitAgent(id: string) { return configuredAgent(id, 'git', 'Выберите агента для коммитов и МР в настройках'); }
/** Who reviews code with the developer: the configured review agent, else the project's. */
export function reviewAgent(id: string) { return configuredAgent(id, 'review', 'Выберите агента для ревью в настройках проекта'); }
/** Who resolves merge/rebase conflicts: the configured conflict agent, else the git agent, else the project's. */
export function conflictAgent(id: string) {
  const choice = resolveAgentChoice(id, { purpose: 'conflict' });
  if (!choice.agentId) throw new DomainError('Выберите агента для конфликтов в настройках');
  return choice;
}
function configuredAgent(id: string, kind: 'git' | 'review', missing: string): { agentId: string; model: string; effort: string } {
  const choice = resolveAgentChoice(id, { purpose: kind });
  if (!choice.agentId) throw new DomainError(missing);
  return choice;
}

export { configureDependencies as configureSettingsDependencies } from './dependencies';
