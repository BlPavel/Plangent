import test from 'node:test';
import assert from 'node:assert/strict';
import { computeWorkState, type WorkInput } from '../work/state';
import type { Task, Workspace, TaskQueue } from '../../models';

const task: Task = { id: 't', project_id: 'p', key: 'T', kind: 'task', status: 'open', auto_review: false, closed_at: null, close_reason: null, origin_task_id: null, created_at: '' };
const workspace: Workspace = { id: 'w', project_id: 'p', task_id: 't', branch: 'work', base_branch: 'main', path: '/w', status: 'ready', error: '', setup_log: '', created_at: '', removed_at: null };
const queue: TaskQueue = { taskId: 't', projectId: 'p', status: 'idle', stages: [], stageIndex: 0, pauseRequested: false, updatedAt: '' };

test('work state: stage, group and primary action across lifecycle and precedence', () => {
  const cases: [string, Partial<WorkInput>, string, string, string][] = [
    ['draft', {}, 'plan', 'preparation', 'plan'],
    ['plan ready', { plan: '- [ ] (p1) Build\n- [x] (p2) Check' }, 'execution', 'preparation', 'queue'],
    ['preparing', { workspace: { ...workspace, status: 'preparing' } }, 'execution', 'preparation', 'chat'],
    ['failed preparation', { workspace: { ...workspace, status: 'failed', error: 'Missing folder' } }, 'execution', 'attention', 'recreate'],
    ['errand running', { task: { ...task, kind: 'errand' }, sessions: [{ role: 'errand', status: 'thinking' }] }, 'execution', 'working', 'chat'],
    ['question', { sessions: [{ role: 'errand', status: 'waiting' }] }, 'execution', 'attention', 'chat'],
    ['paused', { queue: { ...queue, status: 'paused' } }, 'execution', 'attention', 'queue'],
    ['preflight', { queue: { ...queue, status: 'running', stages: [{ id: 's', pauseAfter: false, sessions: [{ id: 'q', agentId: 'a', queueMode: 'review_first', permissionPolicy: 'ask', status: 'ready_for_execution' }] }] } }, 'execution', 'attention', 'queue'],
    ['review', { sessions: [{ role: 'task-reviewer', status: 'thinking' }] }, 'check', 'working', 'check'],
    ['queue done', { workspace, queue: { ...queue, status: 'finished' } }, 'check', 'attention', 'check'],
    ['group task done without workspace', { queue: { ...queue, status: 'finished' } }, 'check', 'attention', 'check'],
    ['errand done in group', { task: { ...task, kind: 'errand' }, sessions: [{ role: 'errand', status: 'complete' }] }, 'check', 'attention', 'check'],
    ['remarks', { workspace, remarks: 2 }, 'check', 'attention', 'check'],
    ['fixes', { workspace, remarks: 2, sessions: [{ role: 'task-chat', status: 'thinking' }] }, 'execution', 'working', 'chat'],
    ['finish', { finish: { status: 'running' } }, 'finish', 'working', 'finish'],
    ['confirm finish', { finish: { status: 'waiting' } }, 'finish', 'attention', 'finish'],
    ['finish error', { finish: { status: 'error', error: 'Hook failed' } }, 'finish', 'attention', 'finish'],
    ['can close', { finish: { status: 'complete' } }, 'finish', 'attention', 'finish'],
    ['closed wins', { task: { ...task, status: 'done', closed_at: 'now' }, remarks: 2, workspace: { ...workspace, status: 'failed' } }, 'done', 'done', 'reopen'],
    ['merged', { task: { ...task, status: 'done' }, mrState: 'merged' }, 'done', 'done', 'errand'],
    ['errand starting', { task: { ...task, kind: 'errand' } }, 'execution', 'preparation', 'chat'],
  ];
  for (const [name, input, stage, group, action] of cases) {
    const state = computeWorkState({ task, ...input });
    assert.deepEqual([state.stage, state.group, state.action], [stage, group, action], name);
    assert.ok(state.text && state.actionLabel, name);
  }
  const counted = computeWorkState({ task, workspace, plan: '- [ ] One\n- [x] Two', remarks: 3 });
  assert.deepEqual(counted.counts, { steps: 2, completed: 1, remarks: 3, waiting: 0, agents: 0 });
  assert.equal(counted.hasBranch, true);
});
