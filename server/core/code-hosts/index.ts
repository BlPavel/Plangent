import { getProject } from '../projects';
import { originUrl } from '../code/git';
import { parseRemoteUrl, type ParsedRemote } from '../projects/remote-url';
import { listConnections, requireConnection, IntegrationError } from '../integrations';
import type { IntegrationConnection } from '../../models/integrations';
import type { CodeHost } from '../../models/code-host';
import { GitLab } from './gitlab';
import { GitHub } from './github';

type HostKind = 'gitlab' | 'github';
/** Connections saved before `code_host` existed are recognised by their GitLab check path. */
const kindOf = (c: IntegrationConnection): HostKind | null => c.code_host === 'gitlab' || c.code_host === 'github' ? c.code_host : !c.code_host && c.auth_config.check_path === '/api/v4/user' ? 'gitlab' : null;
/** github.com is served by api.github.com; other hosts are matched by their own name. */
const hostOf = (c: IntegrationConnection) => { const h = new URL(c.base_url).hostname.toLowerCase(); return kindOf(c) === 'github' && h === 'api.github.com' ? 'github.com' : h; };
const label = { gitlab: 'GitLab', github: 'GitHub' };

export async function resolveCodeHost(projectId: string): Promise<{
  host: CodeHost;
  connectionId: string;
  baseUrl: string;
  projectPath: string;
}> {
  const project = getProject(projectId);
  if (!project || project.kind !== 'project')
    throw new IntegrationError('Repository project not found', 'not_found', 404);
  const group = project.group_id ? getProject(project.group_id) : null;
  const raw = await originUrl(project.repo_path);
  const remote: ParsedRemote | null = raw ? parseRemoteUrl(raw) : null;
  const projectPath = project.host_project_path || remote?.projectPath;
  if (!projectPath)
    throw new IntegrationError('Укажите путь проекта на хостинге или настройте origin');
  const connectionId = project.connection_id || group?.connection_id;
  const candidates = listConnections().filter(c => kindOf(c) && remote && hostOf(c) === remote.host && (!raw?.startsWith('http') || kindOf(c) === 'github' || new URL(c.base_url).port === remote.port));
  const connection = connectionId ? requireConnection(connectionId) : candidates.length === 1 ? candidates[0] : null;
  if (!connection)
    throw new IntegrationError('Выберите подключение GitLab или GitHub в настройках проекта');
  const kind = kindOf(connection);
  if (!kind)
    throw new IntegrationError('Unsupported code host', 'unsupported_host', 422);
  if (kind === 'github' && remote && hostOf(connection) !== remote.host && !project.host_project_path)
    throw new IntegrationError('Подключение ' + label[kind] + ' не относится к этому репозиторию', 'unsupported_host', 422);
  const host = kind === 'github' ? new GitHub(connection.id, projectPath) : new GitLab(connection.id, projectPath);
  return { host, connectionId: connection.id, baseUrl: connection.base_url, projectPath };
}
