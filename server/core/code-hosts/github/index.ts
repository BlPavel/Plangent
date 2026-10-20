import type { CodeHost, HostCapabilities, MergeRequest, CreateMergeRequest } from '../../../models/code-host';
import { authenticatedRequest } from '../../../infrastructure/http/integration-client';
import { IntegrationError } from '../../integrations';
import type { HostRequest } from '../gitlab';

interface PullRequest {
  number: number; title: string; body: string | null; html_url: string; state: string; merged_at: string | null; updated_at: string;
  user: { id: number; login: string };
  head: { ref: string; sha: string }; base: { ref: string; sha: string };
}
const unsupported = (what: string): Promise<never> =>
  Promise.reject(new IntegrationError('GitHub: ' + what + ' пока не поддерживается. Ревью ведётся на локальных ветках, замечания пишите на GitHub.', 'unsupported_host', 422));
/** GitHub pull requests under the code host interface: creating a PR and following its state, nothing else yet. */
export class GitHub implements CodeHost {
  readonly capabilities: HostCapabilities = { batchReview: false, approve: false };
  private prefix: string;
  private owner: string;
  constructor(private connection: string, project: string, private transport: HostRequest = authenticatedRequest) {
    const [owner, repo, ...rest] = project.split('/');
    if (!owner || !repo || rest.length) throw new IntegrationError('Укажите репозиторий GitHub в виде owner/repo');
    this.owner = owner;
    this.prefix = '/repos/' + encodeURIComponent(owner) + '/' + encodeURIComponent(repo);
  }
  private async request<T>(url: string, method = 'GET', input?: unknown): Promise<T> {
    const response = await this.transport(this.connection, url, { method, ...(input === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }) });
    if (!response.body.trim()) return undefined as T;
    try { return JSON.parse(response.body) as T; }
    catch { throw new IntegrationError('GitHub вернул некорректный JSON', 'remote_error', 502); }
  }
  private number(iid: number) {
    if (!Number.isSafeInteger(iid) || iid < 1) throw new IntegrationError('Invalid pull request number');
    return iid;
  }
  private map(pr: PullRequest): MergeRequest {
    return {
      iid: pr.number, title: pr.title, description: pr.body ?? '', web_url: pr.html_url,
      state: pr.merged_at ? 'merged' : pr.state === 'open' ? 'opened' : 'closed',
      author: { id: pr.user.id, name: pr.user.login, username: pr.user.login },
      source_branch: pr.head.ref, target_branch: pr.base.ref, sha: pr.head.sha, updated_at: pr.updated_at,
      diff_refs: { base_sha: pr.base.sha, start_sha: pr.base.sha, head_sha: pr.head.sha },
    };
  }
  async getMergeRequest(iid: number) {
    return this.map(await this.request<PullRequest>(this.prefix + '/pulls/' + this.number(iid)));
  }
  async listMembers() {
    const rows = await this.request<{ login: string }[]>(this.prefix + '/collaborators?per_page=100');
    return rows.map(m => ({ value: m.login, login: m.login, name: m.login }));
  }
  async findMergeRequestForBranch(branch: string) {
    const rows = await this.request<PullRequest[]>(this.prefix + '/pulls?state=open&head=' + encodeURIComponent(this.owner + ':' + branch));
    return rows[0] ? this.map(rows[0]) : null;
  }
  async createMergeRequest(input: CreateMergeRequest) {
    const pr = await this.request<PullRequest>(this.prefix + '/pulls', 'POST', { title: input.title, head: input.source_branch, base: input.target_branch, body: input.description ?? '' });
    // The pull request already exists: reviewers and labels are best effort and must not make the creation look failed.
    const reviewers = input.reviewer_logins ?? [], labels = (input.labels ?? '').split(',').map(l => l.trim()).filter(Boolean);
    if (reviewers.length) await this.request(this.prefix + '/pulls/' + pr.number + '/requested_reviewers', 'POST', { reviewers }).catch(() => undefined);
    const assignees = input.assignee_logins ?? []
    if (assignees.length) await this.request(this.prefix + '/issues/' + pr.number + '/assignees', 'POST', { assignees }).catch(() => undefined);
    if (labels.length) await this.request(this.prefix + '/issues/' + pr.number + '/labels', 'POST', { labels }).catch(() => undefined);
    return this.map(pr);
  }
  mergeRequestRef(iid: number) { return 'refs/pull/' + this.number(iid) + '/head'; }

  listReviewRequests(): Promise<MergeRequest[]> { return unsupported('список PR на ревью'); }
  searchMergeRequests(): Promise<MergeRequest[]> { return unsupported('поиск PR'); }
  getVersions(): Promise<never> { return unsupported('версии PR'); }
  getDiff(): Promise<never> { return unsupported('diff PR через API'); }
  getFile(): Promise<string> { return unsupported('чтение файла через API'); }
  listDiscussions(): Promise<never> { return unsupported('обсуждения PR'); }
  createDiscussion(): Promise<never> { return unsupported('публикация замечаний'); }
  replyToDiscussion(): Promise<never> { return unsupported('ответы в обсуждениях'); }
  resolveDiscussion(): Promise<void> { return unsupported('закрытие обсуждений'); }
  updateNote(): Promise<void> { return unsupported('правка комментариев'); }
  deleteNote(): Promise<void> { return unsupported('удаление комментариев'); }
  currentUser(): Promise<never> { return unsupported('текущий пользователь'); }
  detectCapabilities() { return Promise.resolve(this.capabilities); }
  createDraftNotes(): Promise<void> { return unsupported('черновики замечаний'); }
  publishDrafts(): Promise<void> { return unsupported('публикация замечаний'); }
  updateDraft(): Promise<void> { return unsupported('черновики замечаний'); }
  deleteDraft(): Promise<void> { return unsupported('черновики замечаний'); }
  approve(): Promise<void> { return unsupported('approve'); }
  unapprove(): Promise<void> { return unsupported('approve'); }
}
