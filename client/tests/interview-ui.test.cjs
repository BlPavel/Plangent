const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const { window } = require('linkedom').parseHTML('<html><body><div id="app"></div></body></html>')
for (const key of ['window', 'document', 'HTMLElement', 'SVGElement', 'Element', 'Node', 'Document', 'ShadowRoot']) global[key] = window[key]
Object.defineProperty(window.HTMLTextAreaElement.prototype, 'value', { configurable: true, get() { return this.testValue ?? '' }, set(value) { this.testValue = String(value) } })
// Autosize writes inline heights; linkedom's style declaration corrupts the tree on them.
Object.defineProperty(window.HTMLTextAreaElement.prototype, 'style', { configurable: true, get() { return this.testStyle ??= {} } })
global.requestAnimationFrame = fn => setTimeout(fn, 0)
global.cancelAnimationFrame = clearTimeout
const { createApp, h, reactive, nextTick } = require('vue')
const { createPinia } = require('pinia')
const { build } = require('esbuild')
const { parse, compileScript } = require('@vue/compiler-sfc')

const compiled = (async () => {
  const bundle = await build({
    stdin: { contents: "export { default as InterviewCard } from './client/src/features/agent-chat/components/InterviewCard.vue'; export { answersMessage, sentAnswers, clarifiedQuestions } from './client/src/features/agent-chat/utils/interview'; export { useDraftsStore } from './client/src/core/stores/drafts'", resolveDir: path.resolve('.'), loader: 'ts' },
    bundle: true, write: false, loader: { '.css': 'empty', '.md': 'text' }, platform: 'node', format: 'cjs', external: ['vue', 'pinia'],
    alias: { '@shared': path.resolve('client/src/shared'), '@core': path.resolve('client/src/core') },
    plugins: [{ name: 'vue-test', setup(build) {
      build.onLoad({ filter: /\.vue$/ }, args => {
        const { descriptor } = parse(fs.readFileSync(args.path, 'utf8'), { filename: args.path })
        return { contents: compileScript(descriptor, { id: args.path, inlineTemplate: true }).content, loader: 'ts', resolveDir: path.dirname(args.path) }
      })
    } }],
  })
  const mod = new Module(path.resolve('scripts/.interview-ui-test.cjs'), module)
  mod.filename = path.resolve('scripts/.interview-ui-test.cjs')
  mod.paths = module.paths
  mod._compile(bundle.outputFiles[0].text, mod.filename)
  return mod.exports
})()

const round = { round: 2, total_rounds: 3, topic: 'Данные', upcoming: ['Проверки'], questions: [
  { id: 'items', text: 'Формат элементов?', context: 'От него зависит удаление', options: [{ label: 'Массив { id, text }', detail: 'Стабильные ключи', recommended: true }, { label: 'Массив строк' }] },
  { id: 'remove', text: 'Кто удаляет?', options: [{ label: 'Родитель' }, { label: 'Компонент' }] },
  { id: 'size', text: 'Размеры?', options: [{ label: 'sm/md', recommended: true }, { label: 'Только md' }] },
] }

async function mount(props) {
  const { InterviewCard, useDraftsStore } = await compiled
  const pinia = createPinia()
  const submitted = []
  const state = reactive({ sent: null, finished: false, closed: false, clarified: undefined, ok: true, ...props })
  let app
  const remount = () => {
    app?.unmount()
    app = createApp({ render: () => h(InterviewCard, { sessionId: 's1', seq: 7, round, sent: state.sent, finished: state.finished, closed: state.closed, clarified: state.clarified, submit: async (answers, finish) => { submitted.push(finish ? { finish, answers } : answers); return state.ok } }) })
    app.use(pinia); app.mount('#app')
  }
  remount()
  await nextTick()
  const question = id => document.querySelector(`[data-question="${id}"]`)
  const textarea = id => question(id).querySelector('textarea')
  const choose = async (id, value) => { const input = question(id).querySelector(`[data-choice="${value}"] input`); input.checked = true; input.dispatchEvent(new window.Event('change')); await nextTick() }
  const anyChoice = () => document.querySelector('[data-choice]')
  const button = text => [...document.querySelectorAll('button')].find(b => b.textContent.includes(text))
  const click = async text => { button(text).click(); await new Promise(r => setTimeout(r, 0)); await nextTick() }
  return { state, submitted, question, textarea, anyChoice, choose, button, click, remount, drafts: useDraftsStore(pinia), unmount: () => app.unmount() }
}

test('interview card: options, own answer, clarification, recommendations, draft survives remount', async () => {
  const card = await mount()
  try {
    assert.match(document.body.textContent, /Раунд 2 из 3/)
    assert.match(card.question('items').textContent, /Рекомендую/)
    assert.equal(card.button('Отправить ответы').disabled, true)
    await card.choose('remove', 'custom')
    assert.ok(card.textarea('remove'), 'own answer opens a text field')
    await card.click('Принять рекомендации')
    assert.equal(card.button('Отправить ответы').disabled, true, 'an empty own answer is not an answer')
    assert.match(document.body.textContent, /Отвечено 2 из 3/)
    const textarea = card.textarea('remove')
    textarea.value = 'Через событие'; textarea.dispatchEvent(new window.Event('input')); await nextTick()
    await card.remount()
    assert.match(document.body.textContent, /Отвечено 3 из 3/, 'answers are kept as a draft')
    await card.choose('size', 'clarify')
    card.state.ok = false
    await card.click('Отправить ответы')
    assert.ok(card.drafts.drafts['session:s1:interview:7'], 'a failed send keeps the draft')
    card.state.ok = true
    await card.click('Отправить ответы')
    assert.deepEqual(card.submitted.at(-1), [
      { question_id: 'items', kind: 'option', index: 0 },
      { question_id: 'remove', kind: 'custom', text: 'Через событие' },
      { question_id: 'size', kind: 'clarify', text: '' },
    ])
    assert.deepEqual(card.drafts.drafts['session:s1:interview:7'], { picks: {}, texts: {} }, 'a sent round starts from an empty draft')

    card.state.sent = card.submitted.at(-1); await nextTick()
    assert.equal(card.anyChoice(), null, 'an answered round is read-only')
    assert.match(document.body.textContent, /Ответы отправлены/)
    assert.match(card.question('remove').textContent, /Свой ответ.*Через событие/)
    assert.match(card.question('size').textContent, /Нужно уточнить/)
    card.state.sent = null; card.state.closed = true; await nextTick()
    assert.match(document.body.textContent, /Без ответа/)
    assert.equal(card.button('Отправить ответы'), undefined)
  } finally { card.unmount() }
})

test('interview card: questions asked again after a clarification are marked; the interview can end early', async () => {
  const card = await mount({ clarified: { size: 'Какие размеры?', items: '' } })
  try {
    assert.match(card.question('size').textContent, /После уточнения.*Вы спрашивали: Какие размеры\?/)
    assert.match(card.question('items').textContent, /После уточнения/)
    assert.doesNotMatch(card.question('items').textContent, /Вы спрашивали/)
    assert.doesNotMatch(card.question('remove').textContent, /После уточнения/)
    await card.choose('items', 'o1')
    await card.click('Завершить интервью')
    assert.deepEqual(card.submitted.at(-1), { finish: true, answers: [{ question_id: 'items', kind: 'option', index: 1 }] })
    card.state.sent = card.submitted.at(-1).answers; card.state.finished = true; await nextTick()
    assert.match(document.body.textContent, /Интервью завершено/)
    assert.match(card.question('remove').textContent, /Остался открытым/)
  } finally { card.unmount() }
})

test('interview answers: the message names every question and links back to its round', async () => {
  const { answersMessage, sentAnswers, clarifiedQuestions } = await compiled
  const answers = [{ question_id: 'items', kind: 'option', index: 0 }, { question_id: 'remove', kind: 'custom', text: 'Через событие' }, { question_id: 'size', kind: 'clarify', text: 'Какие размеры?' }]
  const block = answersMessage(7, round, answers)
  assert.match(block.text, /раунд 2 из 3/)
  assert.match(block.text, /\[items\] Формат элементов\?\n {3}Выбран вариант: Массив \{ id, text \} \(рекомендованный\)/)
  assert.match(block.text, /Свой ответ: Через событие/)
  assert.match(block.text, /нужно уточнить в следующем раунде: Какие размеры\?/)
  const sent = sentAnswers([{ seq: 7, type: 'interview_questions', payload: round }, { seq: 9, type: 'user', payload: { text: block.text, content: [block] } }, { seq: 10, type: 'user', payload: { text: 'просто текст', content: [{ type: 'text', text: 'просто текст' }] } }])
  assert.deepEqual([...sent.entries()], [[7, { userSeq: 9, answers, finish: false }]])
  assert.match(block.text, /Интервью продолжается/)
  assert.match(answersMessage(7, { ...round, round: 3 }, [answers[0]]).text, /последний раунд, интервью окончено/)
  assert.match(answersMessage(7, { ...round, round: 3 }, answers).text, /Интервью продолжается/, 'a clarification needs one more round')
  const early = answersMessage(7, round, [answers[0]], true)
  assert.match(early.text, /завершил интервью досрочно[\s\S]*Без ответа[\s\S]*Интервью окончено/)
  assert.equal(early._meta.plangent_interview.finish, true)

  const next = { ...round, round: 3, questions: [round.questions[2], { id: 'new', text: 'Новый?', options: [{ label: 'a' }, { label: 'b' }] }] }
  const events = [{ seq: 7, type: 'interview_questions', payload: round }, { seq: 9, type: 'user', payload: { content: [block] } }, { seq: 11, type: 'interview_questions', payload: next },
    { seq: 12, type: 'user', payload: { content: [answersMessage(11, next, [{ question_id: 'size', kind: 'option', index: 0 }, { question_id: 'new', kind: 'option', index: 0 }])] } },
    { seq: 13, type: 'interview_questions', payload: { ...next, round: 4, total_rounds: 4 } }]
  const clarified = clarifiedQuestions(events, sentAnswers(events))
  assert.deepEqual([...clarified.entries()], [[11, { size: 'Какие размеры?' }]], 'an answered clarification is not marked again')
})
