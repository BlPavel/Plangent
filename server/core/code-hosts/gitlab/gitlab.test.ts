import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPosition } from './position';
import { GitLab } from './index';
import { parseRemoteUrl } from '../../projects/remote-url';
import { IntegrationHttpError } from '../../../infrastructure/http/integration-client';
import { IntegrationError } from '../../integrations';
import type { MrDiff, MrVersion } from '../../../models/code-host';
const version: MrVersion = { id: 1, base_commit_sha: 'base', start_commit_sha: 'start', head_commit_sha: 'head', created_at: '' };
const file: MrDiff = { old_path: 'old.ts', new_path: 'new.ts', new_file: false, deleted_file: false, renamed_file: true, diff: '@@ -10,3 +20,3 @@\n context\n-removed\n+added\n context2\n' };
test('GitLab position: added, removed, offset context and renamed files', () => {
  assert.deepEqual(buildPosition(version, file, 'new', 21), { position_type: 'text', base_sha: 'base', start_sha: 'start', head_sha: 'head', old_path: 'old.ts', new_path: 'new.ts', new_line: 21 });
  assert.equal(buildPosition(version, file, 'old', 11).old_line, 11);
  assert.equal(buildPosition(version, file, 'old', 11).new_line, undefined);
  const context = buildPosition(version, file, 'new', 22);
  assert.equal(context.old_line, 12);
  assert.equal(context.new_line, 22);
  assert.throws(() => buildPosition(version, file, 'new', 100));
  const headers = { ...file, diff: '@@ -1,2 +1 @@\n--- looks like header\n context\n' };
  assert.equal(buildPosition(version, headers, 'old', 1).old_line, 1);
  assert.deepEqual(parseRemoteUrl('ssh://git@host.example:2222/group/repo.git'), { host: 'host.example', port: '2222', projectPath: 'group/repo', normalized: 'host.example:2222/group/repo' });
});
test('provider pagination, search paths, optional APIs and guarded bulk publishing', async () => {
  const calls: {
    url: string;
    method: string;
    body?: unknown;
  }[] = [];
  let drafts = [{ id: 1 }, { id: 2 }, { id: 999 }], bulkUnsupported = false, oldServer = false;
  const provider = new GitLab('connection', 'team/repo', async (_id, url, options) => {
    calls.push({ url, method: options?.method ?? 'GET', body: options?.body ? JSON.parse(String(options.body)) : undefined });
    if (oldServer && /draft_notes|approvals/.test(url))
      throw new IntegrationHttpError(new IntegrationError('unsupported', 'remote_error', 502), url, 404);
    if (bulkUnsupported && url.endsWith('/bulk_publish'))
      throw new IntegrationHttpError(new IntegrationError('unsupported', 'remote_error', 502), url, 405);
    let result: unknown = {};
    if (url === '/api/v4/user')
      result = { id: 5 };
    if (url.includes('/draft_notes?'))
      result = drafts;
    else if (new URL(url, 'https://host').searchParams.get('page') === '1' && !url.includes('draft_notes'))
      result = [{ iid: 1 }];
    else if (new URL(url, 'https://host').searchParams.get('page') === '2')
      result = [{ iid: 2 }];
    return { status: 200, headers: new Headers({ 'x-next-page': new URL(url, 'https://host').searchParams.get('page') === '1' && !url.includes('draft_notes') ? '2' : '' }), body: JSON.stringify(result), url, redirects: [] };
  });
  assert.equal((await provider.listReviewRequests()).length, 2);
  assert.ok(calls.some(c => c.url.includes('reviewer_id=5')));
  assert.ok(calls.some(c => c.url.includes('team%2Frepo')));
  const published: number[] = [];
  await provider.publishDrafts(3, [1, 2], id => published.push(id));
  assert.deepEqual(published, [1, 2]);
  assert.ok(!calls.some(c => c.url.endsWith('bulk_publish')));
  drafts = [{ id: 1 }, { id: 2 }];
  await provider.publishDrafts(3, [1, 2], () => {
  });
  assert.ok(calls.some(c => c.url.endsWith('bulk_publish')));
  bulkUnsupported = true;
  await provider.publishDrafts(3, [1, 2], () => {
  });
  oldServer = true;
  assert.deepEqual(await provider.detectCapabilities(3), { batchReview: false, approve: false });
  assert.equal(provider.mergeRequestRef(3), 'refs/merge-requests/3/head');
});
