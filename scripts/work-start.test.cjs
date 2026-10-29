const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')

function fixture({ current = 'main', occupied = false, workspace = null, baseCommit = null } = {}) {
  const calls = []
  const task = { id: 'task', project_id: 'project', key: 'TEST', base_commit: baseCommit }
  const mocks = {
    '../tasks': { getTask: () => task, updateTask: (_, data) => Object.assign(task, data) },
    '../projects': { getProject: () => ({ id: 'project', kind: 'project', repo_path: '/mock' }), effectiveGitSettings: () => ({ values: { base_branch: 'main', branch_prefixes: ['feature'] } }) },
    '../workspaces': { activeWorkspace: () => workspace, assertTaskWorkspaceReady: () => calls.push('ready'), createWorkspace: async (_, input) => calls.push(input) },
    '../shared/slugify': { slugify: value => value },
    '../code/files': { CodeError: Error },
    '../code/git': { repositoryInfo: async () => ({ branch: current }), branches: async () => [{ name: 'main' }, { name: 'feature/existing' }, { name: 'origin/remote-only' }] },
    './main-folder': { mainFolderWork: () => occupied ? { title: 'Other' } : null },
    '../tasks/base-commit': { captureTaskBaseCommit: async () => { calls.push('capture'); task.base_commit = 'head' } },
  }
  const exports = {}
  const code = ts.transpileModule(fs.readFileSync('server/core/work/start.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  vm.runInNewContext(code, { exports, require: name => mocks[name] ?? require(name) })
  return { start: input => exports.prepareWork('task', input), calls, task }
}

test('existing local and remote branches get their own workspace and baseline', async () => {
  for (const branch of ['feature/existing', 'origin/remote-only']) {
    const f = fixture()
    await f.start({ place: 'existing', branch })
    assert.equal(f.calls[0].branch, branch.replace(/^origin\//, ''))
    assert.equal(f.calls[0].base, 'main')
    assert.equal(f.task.base_commit, 'head')
  }
})

test('the current branch uses the main folder and remains there on restart', async () => {
  const f = fixture()
  await f.start({ place: 'existing', branch: 'main' })
  assert.deepEqual(f.calls, ['capture'])
  await f.start({ place: 'new', branch_name: 'other' })
  assert.deepEqual(f.calls, ['capture'])
  assert.equal(f.task.branch_name, 'main')
})

test('occupied main folder and missing existing branch cannot start', async () => {
  const occupied = fixture({ occupied: true })
  await assert.rejects(occupied.start({ place: 'existing', branch: 'main' }))
  assert.deepEqual(occupied.calls, [])
  const missing = fixture()
  await assert.rejects(missing.start({ place: 'existing', branch: 'gone' }))
  assert.deepEqual(missing.calls, [])
})

test('restarts keep an existing workspace; new branches keep the normal creation path', async () => {
  const pinned = fixture({ workspace: { id: 'workspace' } })
  await pinned.start({ place: 'existing', branch: 'main' })
  assert.deepEqual(pinned.calls, ['ready'])
  const fresh = fixture()
  await fresh.start({ place: 'new', branch_name: 'feature/new' })
  assert.equal(fresh.calls[0].branch, 'feature/new')
  assert.equal(fresh.task.branch_name, 'feature/new')
})
