import test from 'node:test';
import assert from 'node:assert/strict';
import { createExternalThreads, toThread } from './external';
import type { HostDiscussion } from '../../models/code-host';

const user = { id: 1, name: 'Иван', username: 'ivan' };
const refs = { base_sha: 'a', start_sha: 'a', head_sha: 'b' };
const added: HostDiscussion = { id: 'd1', notes: [{ id: 1, body: 'почему так?', author: user, position: { ...refs, position_type: 'text', old_path: 'a.ts', new_path: 'a.ts', new_line: 7 } }] };
const removed: HostDiscussion = { id: 'd2', notes: [{ id: 2, body: 'зачем удалили', author: user, position: { ...refs, position_type: 'text', old_path: 'b.ts', new_path: 'b.ts', old_line: 3, new_line: null } }] };
const general: HostDiscussion = { id: 'd3', notes: [{ id: 3, body: 'в целом ок', author: user }, { id: 4, body: 'merged', author: user, system: true }] };
const system: HostDiscussion = { id: 'd4', notes: [{ id: 5, body: 'added commit', author: user, system: true }] };

function setup(mr: object | null = { iid: 5, title: 'T', web_url: 'u', state: 'opened' }) {
  const replies: unknown[][] = [], resolutions: unknown[][] = [], edits: unknown[][] = [];
  const host = {
    findMergeRequestForBranch: async (b: string) => (b === 'feature' ? mr : null),
    listDiscussions: async () => [added, removed, general, system],
    replyToDiscussion: async (...args: unknown[]) => { replies.push(args); },
    resolveDiscussion: async (...args: unknown[]) => { resolutions.push(args); },
    currentUser: async () => user,
    updateNote: async (...args: unknown[]) => { edits.push(args); },
    deleteNote: async (...args: unknown[]) => { edits.push(['delete', ...args]); },
  };
  return { replies, resolutions, edits, service: createExternalThreads({ branch: async () => 'feature', resolve: async () => ({ host: host as never }) }) };
}

test('discussions map to threads by side, system notes are dropped', () => {
  assert.deepEqual([toThread(added)?.path, toThread(added)?.line, toThread(added)?.side], ['a.ts', 7, 'new']);
  assert.deepEqual([toThread(removed)?.path, toThread(removed)?.line, toThread(removed)?.side], ['b.ts', 3, 'old']);
  assert.equal(toThread(general)?.path, null);
  assert.equal(toThread(general)?.notes.length, 1);
  assert.equal(toThread(system), null);
});

test('pull returns threads of the current branch MR, none without an MR', async () => {
  const pulled = await setup().service.pull('p');
  assert.equal(pulled.mr?.iid, 5);
  assert.equal(pulled.threads.length, 3);
  assert.deepEqual(await setup(null).service.pull('p'), { mr: null, threads: [] });
});

test('reply needs confirmation and a discussion of this MR', async () => {
  const { service, replies } = setup();
  await assert.rejects(service.reply('p', 'd1', 'ok', undefined), /Подтвердите/);
  await assert.rejects(service.reply('p', 'nope', 'ok', true), /не найдено/);
  await assert.rejects(service.reply('p', 'd1', '  ', true), /текст/);
  assert.equal(replies.length, 0);
  await service.reply('p', 'd1', 'исправлю', true);
  assert.deepEqual(replies, [[5, 'd1', 'исправлю']]);
});

test('resolve toggles a discussion of this MR only', async () => {
  const { service, resolutions } = setup();
  await assert.rejects(service.resolve('p', 'nope', true), /не найдено/);
  await assert.rejects(service.resolve('p', 'd1', 'yes'), /Invalid resolved/);
  assert.equal(resolutions.length, 0);
  await service.resolve('p', 'd1', true);
  assert.deepEqual(resolutions, [[5, 'd1', true]]);
});

test('notes are marked mine and only own notes can be edited or deleted', async () => {
  const { service, edits } = setup();
  const pulled = await service.pull('p');
  assert.equal(pulled.threads[0].notes[0].mine, true);
  const other: HostDiscussion = { id: 'd9', notes: [{ id: 9, body: 'x', author: { id: 2, name: 'Пётр', username: 'petr' } }] };
  assert.equal(toThread(other, 1)?.notes[0].mine, false);
  assert.equal(toThread(other)?.notes[0].mine, false);
  await assert.rejects(service.edit('p', 'd1', 99, 'x'), /не найден/);
  await assert.rejects(service.edit('p', 'd1', 1, '  '), /текст/);
  await assert.rejects(service.remove('p', 'd1', 1, undefined), /Подтвердите/);
  assert.equal(edits.length, 0);
  await service.edit('p', 'd1', 1, 'новое');
  await service.remove('p', 'd1', 1, true);
  assert.deepEqual(edits, [[5, 'd1', 1, 'новое'], ['delete', 5, 'd1', 1]]);
});
