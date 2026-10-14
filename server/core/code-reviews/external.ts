import { getProject } from '../projects';
import { repositoryInfo } from '../code/git';
import { CodeError } from '../code/files';
import { IntegrationError } from '../integrations';
import { resolveCodeHost } from '../code-hosts';
import type { CodeHost, HostDiscussion } from '../../models/code-host';

/** A colleague's discussion on the current branch's merge request, kept apart from the developer's threads with the agent. */
export interface ExternalNote { id: number; author: string; body: string }
export interface ExternalThread {
  id: string;
  resolved: boolean;
  /** Null for a general (not line-bound) discussion. */
  path: string | null;
  line: number | null;
  side: 'new' | 'old';
  notes: ExternalNote[];
}
export interface ExternalThreads {
  mr: { iid: number; title: string; url: string; state: string } | null;
  threads: ExternalThread[];
}

export function toThread(d: HostDiscussion): ExternalThread | null {
  const notes = d.notes.filter(n => !n.system);
  if (!notes.length) return null;
  const position = notes.find(n => n.position)?.position;
  const side = position && position.new_line == null && position.old_line != null ? 'old' : 'new';
  return {
    id: d.id,
    resolved: notes.some(n => n.resolved),
    path: position ? (side === 'old' ? position.old_path : position.new_path) : null,
    line: position ? (side === 'old' ? position.old_line : position.new_line) ?? null : null,
    side,
    notes: notes.map(n => ({ id: n.id, author: n.author.name || n.author.username, body: n.body })),
  };
}

interface Dependencies {
  branch: (projectId: string) => Promise<string | null>;
  resolve: (projectId: string) => Promise<{ host: CodeHost }>;
}
const defaults: Dependencies = {
  async branch(projectId) {
    const project = getProject(projectId);
    if (!project || project.kind !== 'project') throw new CodeError('Project not found', 404);
    return (await repositoryInfo(project.repo_path))?.branch ?? null;
  },
  resolve: resolveCodeHost,
};

export function createExternalThreads(dependencies: Dependencies = defaults) {
  async function currentRequest(projectId: string) {
    const branch = await dependencies.branch(projectId);
    if (!branch) throw new CodeError('Выберите локальную рабочую ветку');
    const { host } = await dependencies.resolve(projectId);
    return { host, mr: await host.findMergeRequestForBranch(branch) };
  }
  return {
    /** Pulled on demand only: there is no background sync with the hosting. */
    async pull(projectId: string): Promise<ExternalThreads> {
      const { host, mr } = await currentRequest(projectId);
      if (!mr) return { mr: null, threads: [] };
      const threads = (await host.listDiscussions(mr.iid)).map(toThread).filter((t): t is ExternalThread => !!t);
      return { mr: { iid: mr.iid, title: mr.title, url: mr.web_url, state: mr.state }, threads };
    },
    /** The reply is sent to the hosting, so it needs the developer's explicit confirmation. */
    async reply(projectId: string, discussionId: unknown, body: unknown, confirmed: unknown) {
      if (typeof discussionId !== 'string' || !discussionId) throw new CodeError('Invalid discussion');
      if (typeof body !== 'string' || !body.trim() || body.length > 100000) throw new CodeError('Введите текст ответа');
      if (confirmed !== true) throw new CodeError('Подтвердите отправку ответа в GitLab');
      const { host, mr } = await currentRequest(projectId);
      if (!mr) throw new IntegrationError('Для текущей ветки нет МР', 'not_found', 404);
      if (!(await host.listDiscussions(mr.iid)).some(d => d.id === discussionId))
        throw new CodeError('Обсуждение не найдено в МР текущей ветки. Подтяните замечания заново.', 404);
      await host.replyToDiscussion(mr.iid, discussionId, body);
      return this.pull(projectId);
    },
  };
}
let service: ReturnType<typeof createExternalThreads> | undefined;
export const externalThreads = () => service ??= createExternalThreads();
