const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Module = require('node:module');
const { parseHTML } = require('linkedom');
const { window } = parseHTML('<html><body></body></html>');
for (const key of ['window', 'document', 'HTMLElement', 'SVGElement', 'Element', 'Node']) global[key] = window[key];
global.requestAnimationFrame = callback => setTimeout(callback, 0);
global.cancelAnimationFrame = clearTimeout;
global.getComputedStyle = window.getComputedStyle = () => ({ transitionDelay: '0s', transitionDuration: '0s', animationDelay: '0s', animationDuration: '0s' });
window.HTMLElement.prototype.getBoundingClientRect = () => ({ left: 0, right: 300, top: 10, bottom: 30, width: 300, height: 20 });
const { createApp, h, ref, nextTick } = require('vue');
const { build } = require('esbuild');
const { parse, compileScript } = require('@vue/compiler-sfc');
const ts = require('typescript');
const routes = [], calls = [];
global.__reviewApp = { currentProject: { id: 'project', default_agent_id: 'agent' }, currentTask: { id: 'task', key: 'TASK-1', status: 'in_progress' }, toast() {}, confirm: async () => true };
global.__reviewApi = {
  get: async url => url.endsWith('/skills') ? [{ id: 'skill', title: 'Review skill', origin: 'direct' }] : undefined,
  put: async (url, body) => { calls.push({ url, body }); return { ...global.__reviewQueue.queue.value, stages: body.stages }; },
  post: async (url, body) => { calls.push({ url, body }); return global.__reviewQueue.queue.value; },
};
global.__reviewRoutes = routes;
const source = ts.transpileModule(fs.readFileSync('client/src/features/tasks/composables/useTaskQueue.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const exportsQueue = {};
vm.runInNewContext(source, { exports: exportsQueue, crypto: global.crypto, require: name => name === '@core/api' ? { api: global.__reviewApi }
  : name === '@core/stores/app' ? { useAppStore: () => global.__reviewApp } : require(name) });
global.__reviewQueueKey = exportsQueue.TaskQueueKey;

async function component(file) {
  const bundled = await build({ entryPoints: [path.resolve(file)], bundle: true, write: false, platform: 'node', format: 'cjs', external: ['vue'], loader: { '.css': 'empty' },
    alias: { '@core': path.resolve('client/src/core'), '@shared': path.resolve('client/src/shared') },
    plugins: [{ name: 'vue-test', setup(build) {
      build.onResolve({ filter: /^(?:@core\/api|@core\/stores\/app|@features\/(?:agent-chat|code)|vue-router)$|composables\/useTaskQueue$/ }, args => ({ path: args.path, namespace: 'mock' }));
      build.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ contents:
        args.path === '@core/api' ? 'export const api = globalThis.__reviewApi;'
        : args.path === '@core/stores/app' ? 'export const useAppStore = () => globalThis.__reviewApp;'
        : args.path === 'vue-router' ? 'export const useRouter = () => ({ push: target => globalThis.__reviewRoutes.push(target) });'
        : args.path === '@features/code' ? 'export const codeTarget = (project, task) => ({ project, task });'
        : args.path.includes('useTaskQueue') ? 'export const TaskQueueKey = globalThis.__reviewQueueKey; export const liveSessionMenu = () => [];'
        : `export const useChatStore = () => ({ sessions: [], agentOptions: { agent: {} }, fetchAgentOptions: async () => {} });
           export const modelAndEffort = () => ({ models: [{ value: 'model', label: 'Model' }], efforts: [{value: 'high', label: 'High'}] });`, loader: 'js' }));
      build.onLoad({ filter: /\.vue$/ }, args => {
        const { descriptor } = parse(fs.readFileSync(args.path, 'utf8'), { filename: args.path });
        return { contents: compileScript(descriptor, { id: args.path, inlineTemplate: true }).content, loader: 'ts', resolveDir: path.dirname(args.path) };
      });
    } }],
  });
  const mod = new Module(path.resolve('scripts/.task-review-ui.cjs'), module); mod.filename = path.resolve('scripts/.task-review-ui.cjs'); mod.paths = module.paths;
  mod._compile(bundled.outputFiles[0].text, mod.filename); return mod.exports.default;
}
async function flush() { await new Promise(r => setTimeout(r, 20)); await nextTick(); }
const button = (text, root = document) => {
  const b = [...root.querySelectorAll('button')].find(b => b.textContent.trim() === text); assert.ok(b, 'button: ' + text); return b;
};
test('review queue UI adds, groups, configures and opens results; Code labels and removes agent drafts', async () => {
  const queue = exportsQueue.useTaskQueue(ref('project'), ref('task')); global.__reviewQueue = queue;
  queue.queue.value = { projectId: 'project', taskId: 'task', status: 'idle', stages: [{ id: 'first', pauseAfter: false,
    sessions: [{ id: 'step', points: ['p1'], agentId: 'agent', queueMode: 'execute', permissionPolicy: 'ask', status: 'queued' }] }], stageIndex: 0 };
  const Queue = await component('client/src/features/tasks/components/ExecutionQueue.vue');
  const root = document.createElement('div'); document.body.append(root);
  const app = createApp({ render: () => h(Queue, { agents: [{ id: 'agent', name: 'Agent' }], steps: [{ id: 'p1', text: 'Implement', done: false }], selectedId: null, taskDone: false }) });
  app.provide(exportsQueue.TaskQueueKey, queue); app.mount(root);
  try {
    button('+ Ревью').click(); await flush();
    assert.equal(queue.stages.value.length, 2);
    let review = queue.stages.value[1].sessions[0]; assert.equal(review.kind, 'review'); assert.equal(review.points, undefined);
    const card = root.querySelectorAll('.session')[1];
    const drag = new window.Event('dragstart', { bubbles: true }); drag.dataTransfer = { setData() {} };
    card.dispatchEvent(drag); await flush();
    root.querySelector('.stage').dispatchEvent(new window.Event('drop', { bubbles: true, cancelable: true })); await flush();
    assert.equal(queue.stages.value.length, 1); assert.equal(queue.stages.value[0].sessions.length, 2);
    root.querySelectorAll('.session')[1].querySelector('button[title="Настройки шага"]').click(); await flush();
    const settings = root.querySelector('.review-settings'); assert.ok(settings);
    const labels = [...settings.querySelectorAll('label')].map(l => l.querySelector('span').textContent);
    assert.deepEqual(labels, ['Агент', 'Модель', 'Рассуждения', 'Скилл ревью']);
    const skillLabel = [...settings.querySelectorAll('label')].find(l => l.textContent.includes('Скилл ревью'));
    skillLabel.querySelector('button').click(); await flush(); document.querySelector('.select-option').click(); await flush();
    review = queue.stages.value[0].sessions[1]; assert.equal(review.skillId, 'skill');
    review.status = 'complete'; review.remarks = 3; review.reviewId = 'review'; await flush();
    assert.match(root.textContent, /Ревью: 3 замечания/);
    button('Открыть в «Коде»').click(); await flush(); assert.equal(routes[0].project, 'project'); assert.equal(routes[0].task.id, 'task');
    assert.ok(calls.some(c => c.body?.stages?.[0]?.sessions?.some(s => s.skillId === 'skill')));
  } finally { app.unmount(); root.remove(); }
  const Card = await component('client/src/features/code/components/ItemCard.vue');
  const cardRoot = document.createElement('div'); document.body.append(cardRoot); let removed = false;
  const itemApp = createApp({ render: () => h(Card, { item: { id: 'finding', author: 'agent', origin: 'task', origin_id: 'task', task_key: 'TASK-1',
    scope: 'general', kind: 'fix', text: 'Fix behavior', refs: [], status: 'draft', closed: false }, thread: [], state: 'draft', onRemove: () => { removed = true; } }) });
  itemApp.mount(cardRoot);
  try {
    assert.match(cardRoot.textContent, /агент/); assert.match(cardRoot.textContent, /ревью задачи TASK-1/);
    cardRoot.querySelector('.it-line').click(); await flush(); button('Удалить', cardRoot).click(); await flush(); assert.equal(removed, true);
  } finally { itemApp.unmount(); cardRoot.remove(); }
});

test('queue completion notifications include task review counts', () => {
  const exports = {}, notifications = [], toasts = []; let onEvent;
  const mocks = {
    '@features/code': { announceChanges: async () => {} },
    '../utils/queue-status': (() => { const out = {}; vm.runInNewContext(ts.transpileModule(fs.readFileSync('client/src/features/tasks/utils/queue-status.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports: out }); return out; })(),
    '@core/api/events': { onServerEvent: handler => { onEvent = handler; } },
    '@core/platform': { platform: { notify: (...args) => notifications.push(args) } },
    '@core/stores/app': { useAppStore: () => ({ toast: (...args) => toasts.push(args) }) },
  };
  const source = ts.transpileModule(fs.readFileSync('client/src/features/tasks/composables/useQueueNotifications.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(source, { exports, URLSearchParams, document: { hasFocus: () => true }, require: name => mocks[name] });
  exports.startQueueNotifications({});
  onEvent({ type: 'queue_finished', taskId: 'task', projectId: 'project', taskKey: 'TASK-1', failed: 0, remarks: 3 });
  assert.match(notifications[0][1], /Ревью: 3 замечания/); assert.match(toasts[0][0], /Ревью: 3 замечания/);
  onEvent({ type: 'queue_finished', taskId: 'task', taskKey: 'TASK-1', failed: 0 });
  assert.doesNotMatch(notifications[1][1], /Ревью:/);
});
