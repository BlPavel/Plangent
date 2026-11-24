const { test } = require('node:test')
const assert = require('node:assert/strict')
const { ref, reactive, effectScope, nextTick } = require('vue')
const { loader } = require('./client-test-loader.cjs')

test('DeepSeek Flash role aliases become one choice with a usable adapter id in every picker', () => {
  const { agentSelects, modelAndEffort } = loader()('client/src/features/agent-chat/utils/agent-options.ts')
  const models = [
    { value: 'default', name: 'Default (recommended)', description: 'deepseek-flash[1m]' },
    { value: 'opus', name: 'deepseek-flash[1m] (opus)' },
    { value: 'fable', name: 'Fable 5.1' },
    { value: 'sonnet', name: 'deepseek-flash[1m] (sonnet)' },
    { value: 'haiku', name: 'deepseek-flash' },
    { value: 'deepseek-flash[1m]', name: 'deepseek-flash[1m] (deepseek-flash[1m])' },
  ]
  for (const legacy of [false, true]) {
    for (const current of ['opus', 'default', 'deepseek-flash[1m]']) {
      const source = legacy
        ? { models: { currentModelId: current, availableModels: models.map(m => ({ modelId: m.value, name: m.name, description: m.description })) } }
        : { configOptions: [{ id: 'model', category: 'model', type: 'select', currentValue: current, options: models }] }
      const before = JSON.stringify(source)
      const select = agentSelects(source).find(s => s.kind === 'model')
      assert.equal(select.options.length, 1)
      assert.equal(select.options[0].label, 'DeepSeek Flash')
      assert.equal(select.current, select.options[0].value)
      assert.ok(models.some(m => m.value === select.current), 'never invent an unsupported model id')
      if (current !== 'default') assert.equal(select.current, current)
      assert.deepEqual(modelAndEffort(source).models, select.options)
      assert.equal(JSON.stringify(source), before, 'cached options remain unchanged')
    }
  }
  const mixed = { models: { availableModels: [
    { modelId: 'deepseek-flash', name: 'DeepSeek Flash' },
    { modelId: 'claude-opus', name: 'Claude Opus' },
  ] } }
  assert.equal(modelAndEffort(mixed).models.length, 2, 'other providers retain their models')
})

for (const [model, label] of [['glm-5.3[1m]', 'GLM 5.3'], ['kimi-k3[1m]', 'Kimi K3'], ['k3.1-pro', 'Kimi K3.1 Pro']]) {
  test(label + ' role aliases show one provider model and preserve the selected wire id', () => {
    const { agentSelects } = loader()('client/src/features/agent-chat/utils/agent-options.ts')
    const options = [
      { value: 'default', name: 'Default (recommended)', description: model },
      ...['opus', 'sonnet', 'haiku', 'fable'].map(value => ({ value, name: `${model} (${value})` })),
      { value: model, name: `${model} (${model})` },
      { value: 'other', name: 'Other Claude model' },
    ]
    for (const legacy of [false, true]) {
      for (const current of ['sonnet', 'default', model]) {
        const source = legacy
          ? { models: { currentModelId: current, availableModels: options.map(o => ({ modelId: o.value, name: o.name, description: o.description })) } }
          : { configOptions: [{ id: 'model', category: 'model', type: 'select', currentValue: current, options }] }
        const select = agentSelects(source).find(s => s.kind === 'model')
        assert.equal(select.options.length, 1)
        assert.equal(select.options[0].label, label)
        assert.equal(select.current, current === 'default' ? model : current)
        assert.equal(select.options[0].value, select.current)
      }
    }
    const mixed = { configOptions: [{ id: 'model', category: 'model', type: 'select', options: [
      { value: 'opus', name: `${model} (opus)` },
      { value: 'sonnet', name: 'another-model (sonnet)' },
    ] }] }
    assert.equal(agentSelects(mixed)[0].options.length, 2, 'different model tiers must stay separate')
  })
}

test('distinct GLM role mappings stay separate model choices and preserve their wire ids', () => {
  const { agentSelects } = loader()('client/src/features/agent-chat/utils/agent-options.ts')
  const options = [
    { value: 'default', name: 'Default (recommended)', description: 'glm-5.4[1m]' },
    ...['opus', 'fable'].map(value => ({ value, name: `glm-5.4[1m] (${value})` })),
    ...['sonnet', 'haiku'].map(value => ({ value, name: `glm-5.3[1m] (${value})` })),
    ...['glm-5.4[1m]', 'glm-5.3[1m]'].map(value => ({ value, name: `${value} (${value})` })),
  ]
  for (const current of ['default', 'sonnet', 'glm-5.3[1m]']) {
    const select = agentSelects({ configOptions: [{ id: 'model', category: 'model', type: 'select', currentValue: current, options }] })
      .find(s => s.kind === 'model')
    assert.equal(select.options.map(o => o.label).join(','), 'GLM 5.4,GLM 5.3')
    assert.equal(select.options.length, 2)
    assert.equal(select.current, current === 'default' ? 'glm-5.4[1m]' : current)
    assert.equal(select.options.find(o => o.value === select.current).label, current === 'default' ? 'GLM 5.4' : 'GLM 5.3')
    assert.ok(options.some(o => o.value === select.current), 'never invent an unsupported model id')
  }
})

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
