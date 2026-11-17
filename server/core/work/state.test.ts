import '../../core-services';
import test from 'node:test';
import assert from 'node:assert/strict';
import { computeWorkState, type WorkInput } from './state';
import type { Task, Workspace, TaskQueue } from '../../models';

const task: Task = { id: 't', project_id: 'p', key: 'T', kind: 'task', status: 'open', auto_review: false, closed_at: null, close_reason: null, origin_task_id: null, created_at: '' };
const workspace: Workspace = { id: 'w', project_id: 'p', task_id: 't', branch: 'work', base_branch: 'main', path: '/w', port_slot: 1, status: 'ready', setup_done: 1, error: '', setup_log: '', created_at: '', removed_at: null };
const queue: TaskQueue = { taskId: 't', projectId: 'p', status: 'idle', stages: [], stageIndex: 0, pauseRequested: false, updatedAt: '' };

test('work state: stage, group and primary action across lifecycle and precedence', () => {
  const cases: [string, Partial<WorkInput>, string, string, string][] = [
    ['draft', {}, 'plan', 'preparation', 'plan'],
    ['plan ready', { plan: '- [ ] (p1) Build\n- [x] (p2) Check' }, 'plan', 'preparation', 'queue'],
    ['preparing', { workspace: { ...workspace, status: 'preparing' } }, 'plan', 'preparation', 'chat'],
    ['failed preparation', { workspace: { ...workspace, status: 'failed', error: 'Missing folder' } }, 'plan', 'attention', 'recreate'],
    ['preparing after a queue', { workspace: { ...workspace, status: 'preparing' }, queue: { ...queue, status: 'stopped' } }, 'execution', 'preparation', 'chat'],
    ['errand preparing', { task: { ...task, kind: 'errand' }, workspace: { ...workspace, status: 'preparing' } }, 'execution', 'preparation', 'chat'],
    ['errand running', { task: { ...task, kind: 'errand' }, sessions: [{ role: 'errand', status: 'thinking' }] }, 'execution', 'working', 'chat'],
    ['question', { sessions: [{ role: 'errand', status: 'waiting' }] }, 'execution', 'attention', 'chat'],
    ['paused', { queue: { ...queue, status: 'paused' } }, 'execution', 'attention', 'queue'],
    ['preflight', { queue: { ...queue, status: 'running', stages: [{ id: 's', pauseAfter: false, sessions: [{ id: 'q', agentId: 'a', queueMode: 'review_first', permissionPolicy: 'ask', status: 'ready_for_execution' }] }] } }, 'execution', 'attention', 'queue'],
    ['review', { sessions: [{ role: 'task-reviewer', status: 'thinking' }] }, 'check', 'working', 'check'],
    ['queue done', { workspace, queue: { ...queue, status: 'finished' } }, 'check', 'attention', 'check'],
    ['group task done without workspace', { queue: { ...queue, status: 'finished' } }, 'check', 'attention', 'check'],
    ['errand discussion', { task: { ...task, kind: 'errand' }, sessions: [{ role: 'errand', status: 'ready' }] }, 'execution', 'attention', 'chat'],
    ['errand done in group', { task: { ...task, kind: 'errand' }, workDone: true, sessions: [{ role: 'errand', status: 'complete' }] }, 'check', 'attention', 'check'],
    ['remarks', { workspace, remarks: 2 }, 'check', 'attention', 'check'],
    ['fixes', { workspace, remarks: 2, sessions: [{ role: 'task-chat', status: 'thinking' }] }, 'execution', 'working', 'chat'],
    ['finish', { finish: { status: 'running' } }, 'check', 'working', 'check'],
    ['confirm finish', { finish: { status: 'waiting' } }, 'check', 'attention', 'check'],
    ['finish error', { finish: { status: 'error', error: 'Hook failed' } }, 'check', 'attention', 'check'],
    ['can close', { finish: { status: 'complete' } }, 'check', 'attention', 'check'],
    ['closed wins', { task: { ...task, status: 'done', closed_at: 'now' }, remarks: 2, workspace: { ...workspace, status: 'failed' } }, 'done', 'done', 'reopen'],
    ['merged', { task: { ...task, status: 'done' }, mrState: 'merged' }, 'done', 'done', 'errand'],
    ['errand starting', { task: { ...task, kind: 'errand' } }, 'execution', 'preparation', 'chat'],
  ];
  for (const [name, input, stage, group, action] of cases) {
    const state = computeWorkState({ task, ...input });
    assert.deepEqual([state.stage, state.group, state.action], [stage, group, action], name);
    assert.ok(state.text && state.actionLabel, name);
  }
  const partial = computeWorkState({ task, workspace, plan: '- [x] One\n- [ ] Two', queue: { ...queue, status: 'stopped' }, workDone: true });
  assert.deepEqual([partial.stage, partial.canCheck], ['execution', true]);
  assert.equal(computeWorkState({ task, workspace, plan: '- [ ] One', queue }).canCheck, true);
  assert.equal(computeWorkState({ task, workspace, plan: '- [ ] One', queue: { ...queue, status: 'paused' } }).canCheck, true);
  // A cleared queue with leftover finished executor sessions does not move work past Выполнение while steps are open.
  assert.equal(computeWorkState({ task, workspace, plan: '- [ ] One', queue, sessions: [{ role: 'executor', status: 'complete' }] }).stage, 'execution');
  const running = computeWorkState({ task, workspace, plan: '- [ ] One', queue: { ...queue, status: 'running' }, workDone: true });
  assert.deepEqual([running.stage, running.canCheck], ['execution', false]);
  const counted = computeWorkState({ task, workspace, plan: '- [ ] One\n- [x] Two', remarks: 3 });
  assert.deepEqual(counted.counts, { steps: 2, completed: 1, remarks: 3, waiting: 0, agents: 0 });
  assert.equal(counted.hasBranch, true);
});


test('preparation agents keep their work, questions and errors in preparation', () => {
  for (const role of ['analyst', 'material-author', 'planner', 'plan-reviewer'] as const) {
    for (const status of ['starting', 'thinking', 'waiting', 'error', 'ready', 'complete'] as const) {
      const state = computeWorkState({ task, sessions: [{ role, status }], plan: '- [ ] Draft step' });
      assert.equal(state.stage, 'plan', role + ': ' + status);
      assert.equal(state.canCheck, true); // a filled plan opens Проверка; only a running queue closes it
      assert.equal(state.agentWorking, ['starting', 'thinking'].includes(status));
      if (status === 'waiting') assert.equal(state.counts.waiting, 1);
    }
    const executing = computeWorkState({ task, sessions: [{ role, status: 'thinking' }, { role: 'executor', status: 'thinking' }] });
    assert.equal(executing.stage, 'execution');
    assert.equal(executing.counts.agents, 2);
  }
});
