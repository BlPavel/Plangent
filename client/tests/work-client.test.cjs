const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')

function moduleAt(file, mocks = {}, globals = {}) {
  const exports = {}
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  vm.runInNewContext(source, { exports, require: name => mocks[name] ?? require(name), URLSearchParams, setTimeout, clearTimeout, ...globals }, { filename: file })
  return exports
}

test('code, review, Git, finish and task clients preserve query and cancellation while scoping requests', async () => {
  const calls = []
  const core = moduleAt('client/src/core/api/index.ts', {}, { fetch: async (url, input) => {
    calls.push({ url, ...input })
    return { ok: true, json: async () => ({}), body: { getReader: () => ({ read: async () => ({ done: true }), cancel: async () => {}, releaseLock() {} }) } }
  }, TextDecoder })
  const { codeApi, codeReviewsApi, gitApi, conflictsApi } = moduleAt('client/src/features/code/api.ts', { '@core/api': core })
  const { finishApi } = moduleAt('client/src/features/finish/api.ts', { '@core/api': core })
  const { workApi } = moduleAt('client/src/features/tasks/api.ts', { '@core/api': core })
  const signal = new AbortController().signal
  const workspace = 'work / один'
  await codeApi.changes('project', signal, workspace)
  await codeApi.file('project', 'folder/a & b.ts', signal, workspace)
  await codeApi.diff('project', 'a.ts', { staged: true }, signal, workspace)
  for await (const event of codeApi.search('project', { query: 'test' }, signal, workspace)) void event
  await codeReviewsApi.addDraft('project', { text: 'Remark' }, 'task', 'task', workspace)
  await gitApi.operation('project', 'stage', { paths: ['a.ts'] }, workspace)
  await conflictsApi.state('project', workspace)
  await finishApi.start('project', { scenario: 'commits' }, workspace)
  await workApi.check('project', 'task', workspace)
  for (const call of calls) assert.equal(new URL(call.url, 'http://localhost').searchParams.get('workspace'), workspace)
  assert.equal(calls[0].signal, signal)
  assert.equal(new URL(calls[1].url, 'http://localhost').searchParams.get('path'), 'folder/a & b.ts')
  assert.equal(new URL(codeApi.imageUrl('project', 'a.png', workspace), 'http://localhost').searchParams.get('workspace'), workspace)
  assert.deepEqual(JSON.parse(calls[5].body), { paths: ['a.ts'] })
  await codeApi.changes('project')
  assert.equal(calls.at(-1).url, '/api/projects/project/code/changes')
})

test('workspace subscriptions have independent reference counts, reconnect and typed events', () => {
  const sockets = [], timers = []
  class Socket {
    static OPEN = 1
    readyState = 1
    sent = []
    constructor() { sockets.push(this) }
    send(message) { this.sent.push(JSON.parse(message)) }
    close() {}
  }
  const events = moduleAt('client/src/core/api/events.ts', {}, {
    WebSocket: Socket, location: { protocol: 'http:', host: 'localhost' },
    setTimeout: fn => timers.push(fn), clearTimeout() {},
  })
  const received = []
  const stopWork = events.onWorkEvent(e => received.push(e.type))
  const stopWorkspace = events.onWorkspaceEvent(e => received.push(e.type))
  const first = events.subscribeCodeProject('p', 'w1')
  const same = events.subscribeCodeProject('p', 'w1')
  const second = events.subscribeCodeProject('p', 'w2')
  sockets[0].onopen()
  assert.equal(sockets[0].sent.filter(e => e.type === 'code:subscribe' && e.workspaceId === 'w1').length, 2)
  first()
  assert.equal(sockets[0].sent.filter(e => e.type === 'code:unsubscribe').length, 0)
  sockets[0].onmessage({ data: JSON.stringify({ type: 'workspace:viewing', projectId: 'p', workspace: null }) })
  sockets[0].onmessage({ data: JSON.stringify({ type: 'work:fixes_ready', projectId: 'p', taskId: 't' }) })
  assert.deepEqual(received, ['workspace:viewing', 'work:fixes_ready'])
  sockets[0].onclose(); timers.pop()(); sockets[1].onopen()
  assert.deepEqual(sockets[1].sent.map(e => e.workspaceId), ['w1', 'w2'])
  same(); same(); second(); stopWork(); stopWorkspace()
  assert.deepEqual(sockets[1].sent.filter(e => e.type === 'code:unsubscribe').map(e => e.workspaceId), ['w1', 'w2'])
})
