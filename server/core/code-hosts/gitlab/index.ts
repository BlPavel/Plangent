import type { CodeHost, HostUser, HostCapabilities, HostApprovals, MergeRequest, MrVersion, MrDiff, HostDiscussion, HostNote, ReviewNote, CreateMergeRequest } from '../../../models/code-host';
import { authenticatedRequest, IntegrationHttpError } from '../../../infrastructure/http/integration-client';
import { IntegrationError } from '../../integrations';
export type HostRequest = typeof authenticatedRequest;
const unsupported = (error: unknown) => error instanceof IntegrationHttpError && [404, 405, 501].includes(error.remote_status ?? 0);
export class GitLab implements CodeHost {
  readonly capabilities: HostCapabilities = { batchReview: null, approve: null };
  private prefix: string;
  constructor(private connection: string, project: string, private transport: HostRequest = authenticatedRequest) {
    this.prefix = '/api/v4/projects/' + encodeURIComponent(project);
  }
  private mr(iid: number) {
    if (!Number.isSafeInteger(iid) || iid < 1)
      throw new IntegrationError('Invalid merge request number');
    return this.prefix + '/merge_requests/' + iid;
  }
  private async request<T>(url: string, method = 'GET', input?: unknown): Promise<T> {
    const response = await this.transport(this.connection, url, { method, ...(input === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }) });
    if (!response.body.trim())
      return undefined as T;
    try {
      return JSON.parse(response.body) as T;
    }
    catch {
      throw new IntegrationError('GitLab вернул некорректный JSON', 'remote_error', 502);
    }
  }
  private async list<T>(url: string): Promise<T[]> {
    const result: T[] = [];
    for (let page = 1; page <= 1000; page++) {
      const response = await this.transport(this.connection, url + (url.includes('?') ? '&' : '?') + 'per_page=100&page=' + page);
      let rows: T[];
      try {
        rows = JSON.parse(response.body);
      }
      catch {
        throw new IntegrationError('Invalid GitLab response', 'remote_error', 502);
      }
      if (!Array.isArray(rows))
        throw new IntegrationError('Invalid GitLab list', 'remote_error', 502);
      result.push(...rows);
      const next = response.headers.get('x-next-page');
      if (next === '' || !rows.length || next === null && rows.length < 100)
        return result;
    }
    throw new IntegrationError('GitLab pagination limit exceeded', 'remote_error', 502);
  }
  getMergeRequest(iid: number) {
    return this.request<MergeRequest>(this.mr(iid));
  }
  async listReviewRequests() {
    const user = await this.request<{
      id: number;
    }>('/api/v4/user');
    return this.list<MergeRequest>(this.prefix + '/merge_requests?state=opened&scope=all&reviewer_id=' + user.id);
  }
  listOpenMergeRequests() {
    return this.list<MergeRequest>(this.prefix + '/merge_requests?state=opened&scope=all&order_by=updated_at');
  }
  async getApprovals(iid: number): Promise<HostApprovals | null> {
    let reply: { approved_by?: { user?: HostUser }[]; approvals_required?: number; approvals_left?: number; user_has_approved?: boolean };
    try {
      reply = await this.request(this.mr(iid) + '/approvals');
    }
    catch (e) {
      // Free tiers and restricted accounts have no approvals endpoint: the list shows no counter.
      if (unsupported(e) || e instanceof IntegrationHttpError && e.status === 403)
        return null;
      throw e;
    }
    const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v) ? v : null;
    return { approved_by: (reply.approved_by ?? []).map(a => a.user).filter((u): u is HostUser => !!u), required: num(reply.approvals_required), left: num(reply.approvals_left), mine: reply.user_has_approved === true };
  }
  async searchMergeRequests(query: string) {
    const value = query.trim().replace(/^!/, '');
    if (/^\d+$/.test(value)) {
      try {
        const mr = await this.getMergeRequest(+value);
        return mr.state === 'opened' ? [mr] : [];
      }
      catch (e) {
        if (unsupported(e))
          return [];
        throw e;
      }
    }
    const [title, branch] = await Promise.all([
      this.list<MergeRequest>(this.prefix + '/merge_requests?state=opened&scope=all&search=' + encodeURIComponent(value)),
      this.list<MergeRequest>(this.prefix + '/merge_requests?state=opened&scope=all&source_branch=' + encodeURIComponent(value)),
    ]);
    return [...new Map([...title, ...branch].map(mr => [mr.iid, mr])).values()];
  }
  getVersions(iid: number) {
    return this.list<MrVersion>(this.mr(iid) + '/versions');
  }
  async getDiff(iid: number, version?: number) {
    if (version !== undefined)
      return (await this.request<{
        diffs: MrDiff[];
      }>(this.mr(iid) + '/versions/' + version)).diffs;
    try {
      return await this.list<MrDiff>(this.mr(iid) + '/diffs');
    }
    catch (e) {
      if (!unsupported(e))
        throw e;
      return (await this.request<{
        changes: MrDiff[];
      }>(this.mr(iid) + '/changes')).changes;
    }
  }
  async getFile(path: string, ref: string) {
    const reply = await this.transport(this.connection, this.prefix + '/repository/files/' + encodeURIComponent(path) + '/raw?ref=' + encodeURIComponent(ref));
    return reply.body;
  }
  listDiscussions(iid: number) {
    return this.list<HostDiscussion>(this.mr(iid) + '/discussions');
  }
  createDiscussion(iid: number, note: ReviewNote) {
    return this.request<HostDiscussion>(this.mr(iid) + '/discussions', 'POST', note);
  }
  replyToDiscussion(iid: number, discussion: string, body: string) {
    return this.request<HostNote>(this.mr(iid) + '/discussions/' + encodeURIComponent(discussion) + '/notes', 'POST', { body });
  }
  async resolveDiscussion(iid: number, discussion: string, resolved: boolean) {
    await this.request(this.mr(iid) + '/discussions/' + encodeURIComponent(discussion), 'PUT', { resolved });
  }
  private note(iid: number, discussion: string, note: number) {
    if (!Number.isSafeInteger(note) || note < 1)
      throw new IntegrationError('Invalid note');
    return this.mr(iid) + '/discussions/' + encodeURIComponent(discussion) + '/notes/' + note;
  }
  async updateNote(iid: number, discussion: string, note: number, body: string) {
    await this.request(this.note(iid, discussion, note), 'PUT', { body });
  }
  async deleteNote(iid: number, discussion: string, note: number) {
    await this.request(this.note(iid, discussion, note), 'DELETE');
  }
  currentUser() {
    return this.request<HostUser>('/api/v4/user');
  }
  async detectCapabilities(iid: number) {
    if (this.capabilities.batchReview === null) {
      try {
        await this.list(this.mr(iid) + '/draft_notes');
        this.capabilities.batchReview = true;
      }
      catch (e) {
        if (!unsupported(e))
          throw e;
        this.capabilities.batchReview = false;
      }
    }
    if (this.capabilities.approve === null) {
      try {
        await this.request(this.mr(iid) + '/approvals');
        this.capabilities.approve = true;
      }
      catch (e) {
        if (!unsupported(e) && !(e instanceof IntegrationHttpError && e.status === 403))
          throw e;
        this.capabilities.approve = false;
      }
    }
    return this.capabilities;
  }
  async createDraftNotes(iid: number, notes: ReviewNote[], created: (index: number, id: number) => void) {
    for (const [index, note] of notes.entries()) {
      const draft = await this.request<{
        id: number;
      }>(this.mr(iid) + '/draft_notes', 'POST', { note: note.body, position: note.position });
      created(index, draft.id);
    }
  }
  async publishDrafts(iid: number, ids: number[], published: (id: number) => void) {
    if (!ids.length)
      return;
    const remote = await this.list<{
      id: number;
    }>(this.mr(iid) + '/draft_notes');
    // bulk_publish includes every draft owned by the user. Do not publish unrelated web drafts.
    if (remote.length === ids.length && remote.every(d => ids.includes(d.id))) {
      try {
        await this.request(this.mr(iid) + '/draft_notes/bulk_publish', 'POST');
        ids.forEach(published);
        return;
      }
      catch (e) {
        if (!unsupported(e))
          throw e;
      }
    }
    for (const id of ids) {
      await this.request(this.mr(iid) + '/draft_notes/' + id + '/publish', 'PUT');
      published(id);
    }
  }
  async updateDraft(iid: number, id: number, note: ReviewNote) {
    await this.request(this.mr(iid) + '/draft_notes/' + id, 'PUT', { note: note.body, position: note.position });
  }
  async deleteDraft(iid: number, id: number) {
    await this.request(this.mr(iid) + '/draft_notes/' + id, 'DELETE');
  }
  async approve(iid: number, sha: string) {
    await this.request(this.mr(iid) + '/approve', 'POST', { sha });
    this.capabilities.approve = true;
  }
  async unapprove(iid: number) {
    await this.request(this.mr(iid) + '/unapprove', 'POST');
  }
  async listMembers() {
    const rows = await this.list<{ id: number; username: string; name: string; state: string }>(this.prefix + '/members/all');
    return rows.filter(m => m.state === 'active').map(m => ({ value: String(m.id), login: m.username, name: m.name }));
  }
  createMergeRequest(input: CreateMergeRequest) {
    return this.request<MergeRequest>(this.prefix + '/merge_requests', 'POST', input);
  }
  async findMergeRequestForBranch(branch: string) {
    return (await this.list<MergeRequest>(this.prefix + '/merge_requests?state=opened&scope=all&source_branch=' + encodeURIComponent(branch)))[0] ?? null;
  }
  mergeRequestRef(iid: number) {
    this.mr(iid);
    return 'refs/merge-requests/' + iid + '/head';
  }
}
