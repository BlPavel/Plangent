const assert = require('node:assert/strict')
const { File } = require('node:buffer')
const { test } = require('node:test')
const { loader } = require('./client-test-loader.cjs')

function setup() {
  const window = {}
  const calls = []
  const replies = new Map()
  const listeners = new Map()
  const filePaths = new Map()
  const load = loader({
    electron: {
      contextBridge: {
        exposeInMainWorld: (key, api) => { window[key] = api },
      },
      ipcRenderer: {
        invoke: async (channel, ...args) => {
          calls.push(['invoke', channel, ...args])
          assert.ok(replies.has(channel), `Unexpected invoke on ${channel}`)
          return replies.get(channel)
        },
        send: (channel, ...args) => { calls.push(['send', channel, ...args]) },
        on: (channel, handler) => { listeners.set(channel, handler) },
      },
      webUtils: {
        getPathForFile: (file) => {
          assert.ok(filePaths.has(file), 'Expected the original File object')
          return filePaths.get(file)
        },
      },
    },
  }, { window })

  load('electron/preload.ts')
  const { platform } = load('client/src/core/platform/index.ts')
  function emit(channel, value) {
    assert.ok(listeners.has(channel), `Expected subscription to ${channel}`)
    listeners.get(channel)({ senderId: 42 }, value)
  }
  return { platform, calls, replies, filePaths, emit }
}

test('folder picker passes the default path and returns selection or cancellation', async () => {
  const { platform, calls, replies } = setup()
  replies.set('dialog:pick-folder', '/projects/selected')
  assert.equal(await platform.pickFolder('/projects/start'), '/projects/selected')
  replies.set('dialog:pick-folder', null)
  assert.equal(await platform.pickFolder(), null)
  assert.deepEqual(calls, [
    ['invoke', 'dialog:pick-folder', '/projects/start'],
    ['invoke', 'dialog:pick-folder', undefined],
  ])
})

test('file path lookup forwards the original file and normalizes an empty path', () => {
  const { platform, filePaths } = setup()
  const file = new File(['text'], 'notes.txt')
  filePaths.set(file, '/projects/notes.txt')
  assert.equal(platform.getFilePath(file), '/projects/notes.txt')
  filePaths.set(file, '')
  assert.equal(platform.getFilePath(file), null)
})

test('empty native clipboard image is returned as null', async () => {
  const { platform, calls, replies } = setup()
  replies.set('clipboard:image', null)
  assert.equal(await platform.getClipboardImage(), null)
  assert.deepEqual(calls, [['invoke', 'clipboard:image']])
})

test('notification target crosses the bridge in both directions', () => {
  const { platform, calls, emit } = setup()
  const target = '/projects/42/tasks/7'
  platform.notify('Build', 'Finished', target)
  assert.deepEqual(calls.map(([kind, channel, payload]) => [kind, channel, { ...payload }]), [
    ['send', 'agent:notify', { title: 'Build', body: 'Finished', target }],
  ])

  const clicks = []
  platform.onNotificationClick((...args) => { clicks.push(args) })
  emit('notification:click', target)
  assert.deepEqual(clicks, [[target]])
})

test('update state is returned on request and forwarded on change', async () => {
  const { platform, calls, replies, emit } = setup()
  const downloading = { status: 'downloading', version: '2.0.0', percent: 60 }
  replies.set('update:get-state', downloading)
  assert.deepEqual(await platform.updates.getState(), downloading)
  assert.deepEqual(calls, [['invoke', 'update:get-state']])

  const changes = []
  platform.updates.onState((...args) => { changes.push(args) })
  const ready = { status: 'ready', version: '2.0.0' }
  emit('update:state', ready)
  assert.deepEqual(changes, [[ready]])
})
