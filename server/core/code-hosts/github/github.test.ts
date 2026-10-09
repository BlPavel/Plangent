import test from 'node:test';
import assert from 'node:assert/strict';
import { GitHub } from './index';
import { IntegrationHttpError } from '../../../infrastructure/http/integration-client';
import { IntegrationError } from '../../integrations';
import { integrationPresets } from '../../integrations/presets';
import { validateAuthConfig } from '../../integrations';

const pr = (over: Record<string, unknown> = {}) => ({
  number: 7, title: 'Add thing', body: 'Body', html_url: 'https://github.com/o/r/pull/7', state: 'open', merged_at: null, updated_at: '2026-01-01T00:00:00Z',
  user: { id: 5, login: 'dev' }, head: { ref: 'feature/x', sha: 'h'.repeat(40) }, base: { ref: 'main', sha: 'b'.repeat(40) }, ...over,
});
const fake = (routes: (url: string, method: string, body: unknown) => unknown, calls: { url: string; method: string; body?: unknown }[] = []) =>
  new GitHub('c', 'o/r', async (_id, url, options) => {
    const body = options?.body ? JSON.parse(String(options.body)) : undefined;
    calls.push({ url, method: options?.method ?? 'GET', body });
    const result = routes(url, options?.method ?? 'GET', body);
    if (result instanceof Error) throw result;
    return { status: 200, headers: new Headers(), body: JSON.stringify(result), url, redirects: [] } as never;
  });

test('GitHub: create PR maps to the host contract, reviewers and labels are best effort', async () => {
  const calls: { url: string; method: string; body?: unknown }[] = [];
  const host = fake((url, method) => {
    if (url.endsWith('/requested_reviewers')) return new IntegrationHttpError(new IntegrationError('x', 'remote_error', 502), url, 422);
    return method === 'POST' && url === '/repos/o/r/pulls' ? pr() : [];
  }, calls);
  const mr = await host.createMergeRequest({ source_branch: 'feature/x', target_branch: 'main', title: 'Add thing', description: 'Body', reviewer_logins: ['dev'], labels: 'a, b', squash: true });
  assert.deepEqual(calls[0], { url: '/repos/o/r/pulls', method: 'POST', body: { title: 'Add thing', head: 'feature/x', base: 'main', body: 'Body' } });
  assert.deepEqual(calls[1].body, { reviewers: ['dev'] });
  assert.equal(calls[2].url, '/repos/o/r/issues/7/labels');
  assert.deepEqual(calls[2].body, { labels: ['a', 'b'] });
  assert.equal(mr.iid, 7);
  assert.equal(mr.state, 'opened');
  assert.equal(mr.web_url, 'https://github.com/o/r/pull/7');
  assert.equal(mr.source_branch, 'feature/x');
  assert.equal(mr.sha, 'h'.repeat(40));
});

test('GitHub: state mapping, branch lookup, refs and unsupported review operations', async () => {
  const calls: { url: string; method: string }[] = [];
  const host = fake(url => url.includes('?state=open') ? [pr()] : pr({ state: 'closed', merged_at: '2026-01-02T00:00:00Z' }), calls);
  assert.equal((await host.getMergeRequest(7)).state, 'merged');
  assert.equal((await fake(() => pr({ state: 'closed' })).getMergeRequest(7)).state, 'closed');
  assert.equal((await host.findMergeRequestForBranch('feature/x'))?.iid, 7);
  assert.equal(calls[1].url, '/repos/o/r/pulls?state=open&head=o%3Afeature%2Fx');
  assert.equal(host.mergeRequestRef(7), 'refs/pull/7/head');
  await assert.rejects(host.getMergeRequest(0), /Invalid pull request number/);
  assert.equal(await fake(() => []).findMergeRequestForBranch('none'), null);
  await assert.rejects(host.listReviewRequests(), /не поддерживается/);
  await assert.rejects(host.createDiscussion(), /не поддерживается/);
  assert.throws(() => new GitHub('c', 'only-owner'), /owner\/repo/);
});

test('GitHub preset: bearer token, Accept header and a valid saved shape', () => {
  const preset = integrationPresets.find(p => p.id === 'github-token')!;
  assert.doesNotThrow(() => validateAuthConfig(preset.auth_strategy, preset.auth_config));
  assert.equal(preset.code_host, 'github');
  assert.equal(preset.auth_config.token_header, 'Authorization');
  assert.equal(preset.auth_config.token_prefix, 'Bearer ');
  assert.equal(preset.auth_config.check_path, '/user');
});
