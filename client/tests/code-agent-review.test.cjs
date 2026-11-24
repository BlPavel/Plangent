const test = require('node:test')
const assert = require('node:assert/strict')
const { parseHTML } = require('linkedom')
const { window } = parseHTML('<html><body></body></html>')
for (const key of ['window', 'document', 'HTMLElement', 'SVGElement', 'Element', 'Node']) global[key] = window[key]
const { createApp, h, reactive, ref, nextTick } = require('vue')
const { loader } = require('./client-test-loader.cjs')

const Button = { inheritAttrs: false, setup(_, { attrs, slots }) { return () => h('button', attrs, slots.default?.()) } }
const Select = { props: ['modelValue', 'options', 'label', 'disabled'], emits: ['update:modelValue'],
  setup(props, { emit }) { return () => h('select', { 'aria-label': props.label, disabled: props.disabled,
    onChange: event => emit('update:modelValue', event.target.value) }, props.options.map(option => h('option', { value: option.value, selected: props.modelValue === option.value }, option.label))) } }
const Picker = { emits: ['change'], setup(_, { emit }) { emit('change', { agent_id: 'reviewer', model: 'model', effort: 'high', config: {} }); return () => h('div', 'Read-only reviewer') } }
const flush = async () => { await nextTick(); await new Promise(resolve => setTimeout(resolve, 0)); await nextTick() }
const button = (root, label) => { const result = [...root.querySelectorAll('button')].find(b => b.textContent === label); assert.ok(result, label); return result }

test('Code review UI previews both ranges, starts read-only review, shows empty reports and stops active work', async () => {
  const requests = [], stopped = []
  const code = reactive({ readOnly: false, openedReviewId: null, workspaceId: 'workspace', repository: { head: 'head' }, changes: [],
    rounds: [], review: null, agentWorking: false, refresh: async () => {}, stopAgent: async id => { stopped.push(id) } })
  const git = reactive({ branches: [{ name: 'origin/main', ref: 'refs/remotes/origin/main' }], baseRef: 'origin/main' })
  const chats = reactive({ sessions: [], put(session) { this.sessions.push(session) } })
  const load = loader({
    '@shared/ui/AppButton.vue': { default: Button }, '@shared/ui/AppSelect.vue': { default: Select }, '@shared/ui/BranchSelect.vue': { default: Select },
    '@shared/markdown': { MessageMarkdown: { props: ['text'], setup: props => () => h('div', props.text) } },
    '@features/agent-chat': { ReviewAgentBar: Picker, UsageMeter: { setup: () => () => h('i') }, useChatStore: () => chats, statusLabel: status => status },
    '@features/agents': { useAgentsStore: () => ({ agents: [{ id: 'reviewer', name: 'Ревьюер' }] }), ensureAgentCli: async () => ({ installed: true, state: 'done' }), getAgentInstallMode: async () => 'ask' },
    '@features/branch-review': { branchReviewEndpoints: { getProjectsByProjectIdBranchReviewSkills: async () => [{ id: 'skill', title: 'Skill' }] } },
    '../stores/context': { useCodeContext: () => code, useGitContext: () => git },
    '../api': { codeEndpoints: {
      previewAgentReview: async input => { requests.push({ preview: input }); return { base: '123456789', files: ['a.ts'], branch: 'feature' } },
      startAgentReview: async input => {
        requests.push({ start: input }); code.review = { id: 'review' }; code.rounds = [{ id: 'round', session_id: 'session' }]; code.agentWorking = true
        return { id: 'session', agent_id: 'reviewer', role: 'task-reviewer', status: 'thinking', metadata: { code_review: true, code_review_range: input.body, task_review_items: [] }, reason: '' }
      },
    } },
  })
  const Component = load('client/src/features/code/components/AgentReview.vue').default
  const root = document.createElement('div'); document.body.append(root)
  const journal = ref(''); const app = createApp({ render: () => h(Component, { projectId: 'project', journal: journal.value, 'onUpdate:journal': value => { journal.value = value } }) }); app.mount(root)
  try {
    await flush()
    assert.doesNotMatch(root.textContent, /Read-only reviewer/)
    button(root, '🤖 Ревью агентом').click(); await flush()
    assert.ok(![...root.querySelectorAll('button')].some(b => b.textContent === '🤖 Ревью агентом'))
    assert.match(root.textContent, /Read-only reviewer/)
    const actions = [...root.querySelectorAll('button')].filter(b => ['Отмена', 'Начать проверку'].includes(b.textContent))
    assert.deepEqual(actions.map(b => b.textContent), ['Отмена', 'Начать проверку'])
    assert.ok(actions.every(b => b.getAttribute('size') === 'xs'))
    button(root, 'Отмена').click(); await flush()
    assert.doesNotMatch(root.textContent, /Read-only reviewer/)
    button(root, '🤖 Ревью агентом').click(); await flush()
    assert.equal(requests.at(-1).preview.body.mode, 'worktree')
    assert.match(root.textContent, /1 файл/)
    const select = root.querySelector('[aria-label="Область ревью"]')
    select.querySelector('[value="branch"]').selected = true; select.dispatchEvent(new window.Event('change')); await flush()
    assert.equal(requests.at(-1).preview.body.mode, 'branch')
    assert.equal(requests.at(-1).preview.body.ref, 'refs/remotes/origin/main')
    button(root, 'Начать проверку').click(); await flush()
    const started = requests.find(request => request.start).start
    assert.equal(started.query.workspace, 'workspace'); assert.equal(started.body.agent_id, 'reviewer'); assert.equal(started.body.effort, 'high')
    assert.match(root.textContent, /Агент проверяет код/)
    button(root, 'Остановить').click(); await flush(); assert.deepEqual(stopped, ['review'])
    chats.sessions[0].status = 'complete'; chats.sessions[0].reason = 'Проверено: новых замечаний нет'; code.agentWorking = false
    await flush(); assert.doesNotMatch(root.textContent, /новых замечаний нет/); assert.match(root.textContent, /Ревьюер/)
    button(root, 'Журнал').click(); await flush(); assert.equal(journal.value, 'session'); assert.match(root.textContent, /← Замечания/)
  } finally { app.unmount(); root.remove() }
})

test('manual branch entry and its client API have been removed', () => {
  const fs = require('node:fs')
  assert.doesNotMatch(fs.readFileSync('client/src/features/branch-review/views/BranchReviewTab.vue', 'utf8'), /Ветка вручную|branchOptions|loadBranches/)
  assert.doesNotMatch(fs.readFileSync('client/src/features/branch-review/api.ts', 'utf8'), /branch-review\/(?:branches|fetch|open)['"]/)
})
