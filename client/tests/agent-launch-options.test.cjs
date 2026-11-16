const { test } = require('node:test')
const assert = require('node:assert/strict')
const { ref, reactive, effectScope, nextTick } = require('vue')
const { loader } = require('./client-test-loader.cjs')

function fixture(t, source) {
  const chat = reactive({ agentOptions: { first: source, second: source }, fetchAgentOptions() {} })
  const agents = { agents: [{ id: 'first', model: 'chosen-model', reasoning_effort: 'high' }] }
  const load = loader({
    '@features/agents': { useAgentsStore: () => agents },
    '../stores/sessions': { useChatStore: () => chat },
  })
  const agentId = ref('first'), scope = effectScope()
  t.after(() => scope.stop())
  const options = scope.run(() => load('client/src/features/agent-chat/composables/useAgentLaunchOptions.ts').useAgentLaunchOptions(agentId))
  return { ...options, agentId }
}

function codex(configOnly) {
  const ids = ['read-only', 'workspace-write', 'danger-full-access']
  return configOnly
    ? { configOptions: [{ id: 'sandbox', category: 'mode', type: 'select', currentValue: 'read-only',
      options: ids.map(value => ({ value, name: value })) }] }
    : { modes: { currentModeId: 'read-only', availableModes: ids.map(id => ({ id, name: id })) } }
}

for (const configOnly of [false, true]) {
  test('an untouched Codex mode stays automatic (' + (configOnly ? 'config' : 'modes') + ')', t => {
    const options = fixture(t, codex(configOnly))
    const mode = options.resolvedSelects.value.find(s => s.kind === 'mode')
    assert.equal(mode.current, '')
    assert.equal(mode.options.find(o => o.value === '').label, 'Автоматически')
    assert.equal(mode.options.some(o => o.value === 'danger-full-access'), false)
    assert.equal(options.launch().mode, '', 'the probe default must not override server permission policy')
  })

  test('explicit Codex modes are preserved and can be reset to automatic (' + configOnly + ')', t => {
    const options = fixture(t, codex(configOnly))
    const mode = () => options.resolvedSelects.value.find(s => s.kind === 'mode')
    for (const value of ['read-only', 'workspace-write', '']) {
      options.pick(mode(), value)
      assert.equal(mode().current, value)
      assert.equal(options.launch().mode, value)
    }
  })
}

test('an explicit mode belongs to its agent and is cleared when the agent changes', async t => {
  const options = fixture(t, codex(false))
  options.pick(options.resolvedSelects.value.find(s => s.kind === 'mode'), 'read-only')
  options.agentId.value = 'second'
  await nextTick()
  assert.equal(options.launch().mode, '')
  assert.equal(options.resolvedSelects.value.find(s => s.kind === 'mode').current, '')
})

test('Claude plan mode is explicit while model and reasoning presets still apply', t => {
  const options = fixture(t, {
    modes: { currentModeId: 'plan', availableModes: ['default', 'acceptEdits', 'plan'].map(id => ({ id, name: id })) },
    configOptions: [
      { id: 'model', category: 'model', type: 'select', currentValue: 'probe-model',
        options: ['probe-model', 'chosen-model'].map(value => ({ value, name: value })) },
      { id: 'effort', category: 'thought_level', type: 'select', currentValue: 'low',
        options: ['low', 'high'].map(value => ({ value, name: value })) },
    ],
  })
  assert.equal(options.launch().mode, '')
  assert.equal(options.launch().model, 'chosen-model')
  assert.equal(options.launch().config.effort, 'high')
  options.pick(options.resolvedSelects.value.find(s => s.kind === 'mode'), 'plan')
  assert.equal(options.launch().mode, 'plan')
})

test('Codex planning is a separate configuration choice and does not force a sandbox mode', t => {
  const source = codex(true)
  source.configOptions.push({ id: 'collaboration', category: 'collaboration_mode', type: 'select', currentValue: 'default',
    options: ['default', 'plan'].map(value => ({ value, name: value })) })
  const options = fixture(t, source)
  options.pick(options.resolvedSelects.value.find(s => s.configId === 'collaboration'), 'plan')
  assert.equal(options.launch().mode, '')
  assert.equal(options.launch().config.collaboration, 'plan')
})

test('an agent without reported modes leaves mode selection to the server', t => {
  const options = fixture(t, {})
  assert.equal(options.resolvedSelects.value.length, 0)
  assert.equal(options.launch().mode, '')
})
