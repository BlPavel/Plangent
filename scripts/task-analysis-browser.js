
localStorage.clear(); const sockets = []
window.WebSocket = class { constructor() { sockets.push(this) } close() {} }
const db = { task: { id: 'task', key: 'TEST', project_id: 'project', status: 'open', title: 'UI test' }, sections: [], plan: null, chats: {}, runs: [], calls: [], warnings: [] }
window.testDb = db; const json = (data, status = 200) => new Response(status === 204 ? null : JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
window.fetch = async (input, init = {}) => {
 const url = new URL(String(input), location.origin), path = url.pathname, method = init.method ?? 'GET', body = init.body ? JSON.parse(init.body) : {}
 db.calls.push({ path, method, body })
 const base = '/api/projects/project/tasks/task'
 if (path === '/api/agents') return json([{ id: 'agent', name: 'Mock', model: '', acp_command: '', acp_args: [], active: true }])
 if (path.includes('/acp-options')) return json({ configOptions: [] })
 if (path.includes('/limits')) return json({})
 if (path === base) return json(db.task)
 if (path === base + '/plans/latest') return db.plan ? json(db.plan) : json({ error: 'No plan' }, 404)
 if (path === base + '/queue') return json({ taskId: 'task', projectId: 'project', status: 'idle', stages: [], history: [] })
 if (path === base + '/analysis') {
   if (method === 'POST') { const section = { ...body, id: 's' + (db.sections.length + 1), slug: 'section' + (db.sections.length + 1), author: 'developer', files: [] }; db.sections.push(section); return json(section) }
   return json(db.sections)
 }
 if (path === base + '/analysis/reorder') { db.sections.sort((a,b) => body.ids.indexOf(a.id) - body.ids.indexOf(b.id)); return json(db.sections) }
 if (path.startsWith(base + '/analysis/')) {
   const parts = path.slice((base + '/analysis/').length).split('/'), section = db.sections.find(s => s.id === parts[0])
   if (parts[1] === 'files') {
     if (method === 'POST') { const file = { id: 'file', name: body.name, mime: body.mime ?? 'text/plain', size: 3 }; section.files.push(file); return json(file) }
     if (method === 'DELETE') { section.files = section.files.filter(f => f.id !== parts[2]); return json(null, 204) }
     return new Response('API', { headers: { 'Content-Type': 'text/plain' } })
   }
   if (method === 'PATCH') { Object.assign(section, body); return json(section) }
   if (method === 'DELETE') {
     if (!url.searchParams.has('confirm') && db.plan) return json({ confirmation_required: true, references: db.plan.steps }, 409)
     db.sections = db.sections.filter(s => s.id !== section.id); return json(null, 204)
   }
 }
 if (path === base + '/runs' && method === 'POST') {
   const id = 'chat' + (db.runs.length + 1), run = { id: id + '-run' }
   db.runs.push(run)
   db.chats[id] = { session: { id, title: body.purpose, project_id: 'project', task_id: 'task', agent_id: 'agent', status: 'ready', role: body.purpose === 'plan' ? 'planner' : 'analyst', policy: 'read-only', metadata: {} }, events: [], streaming: null, queue: [], permissions: [] }
   return json({ run, session_id: id, mode: 'acp' })
 }
 if (path.startsWith('/api/agent-sessions/')) {
   const parts = path.slice('/api/agent-sessions/'.length).split('/'), snap = db.chats[parts[0]]
   if (parts[1] === 'prompt') { snap.events.push({ seq: snap.events.length + 1, type: 'user', session_id: parts[0], payload: { text: body.content[0].text } }); return json(snap) }
   return json(snap)
 }
 if (path.endsWith('/done')) { db.task.status = 'done'; return json(db.task) }
 if (path.endsWith('/reopen')) { db.task.status = 'open'; return json(db.task) }
 return json([])
}
const { createApp, nextTick } = await import('vue')
const { createPinia } = await import('pinia')
const { createRouter, createMemoryHistory } = await import('vue-router')
const { default: TaskView } = await import('/src/features/tasks/views/TaskView.vue')
const { useAppStore } = await import('/src/core/stores/app.ts')
const { useChatStore } = await import('/src/features/agent-chat/stores/sessions.ts')
const pinia = createPinia()
const appStore = useAppStore(pinia)
appStore.currentProject = { id: 'project', name: 'Test', repo_path: '', default_agent_id: 'agent' }
appStore.currentTask = db.task
appStore.confirm = async text => { db.warnings.push(text); return true }
const chatStore = useChatStore(pinia)
chatStore.connect = async () => {}
const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/task/:id', component: TaskView }] })
await router.push('/task/task')
let viewApp = createApp(TaskView).use(pinia).use(router)
viewApp.mount('#app')
window.ready = true
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const visible = el => el && el.getClientRects().length > 0
const button = text => [...document.querySelectorAll('button')].find(el => visible(el) && (el.textContent.trim() === text || el.getAttribute('aria-label') === text || el.title === text))
async function until(check) { const end = Date.now() + 6000; while (!check()) { if (Date.now() > end) throw new Error('Timed out: ' + document.body.innerText); await sleep(30) } }
const assert = (ok, message) => { if (!ok) throw new Error(message) }
async function click(text) { await until(() => button(text)); button(text).click(); await nextTick(); await sleep(60) }
function input(selector, value) { const el = document.querySelector(selector); assert(el, 'Missing input ' + selector); el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })) }
function event(value) { for (const s of sockets) s.onmessage?.({ data: JSON.stringify(value) }) }
window.runScenario = async () => {
 await until(() => button('Анализ')?.classList.contains('active'))
 await click('+ Добавить исходный')
 input('[aria-label="Заголовок нового раздела"]', 'API')
 input('[aria-label="Описание нового раздела"]', 'Initial description')
 await click('Создать')
 await until(() => document.querySelector('article'))
 await click('Ещё')
 await click('Редактировать')
 input('[aria-label="Описание раздела"]', 'My draft')
 db.sections[0].description = 'Agent edit'
 event({ type: 'analysis_updated', taskId: 'task', actor: 'agent' })
 await until(() => button('Показать изменения'))
 assert(document.querySelector('[aria-label="Описание раздела"]').value === 'My draft', 'Agent overwrote draft')
 await click('Показать изменения')
 assert(document.querySelector('[aria-label="Описание раздела"]').value === 'Agent edit', 'Did not reload agent change')
 db.sections[0].description = 'Agent again'
 event({ type: 'analysis_updated', taskId: 'task', actor: 'agent' })
 await until(() => button('Оставить моё'))
 input('[aria-label="Описание раздела"]', 'Kept draft')
 await click('Оставить моё')
 await click('Сохранить')
 await until(() => db.sections[0].description === 'Kept draft')
 await click('Ещё')
 await click('В проработанные')
 await until(() => db.sections[0].kind === 'worked')
 await until(() => document.querySelector('.card-toggle'))
 if (!document.querySelector('.file-drop')) document.querySelector('.card-toggle').click()
 await until(() => document.querySelector('.file-drop input[type=file]'))
 const fileInput = document.querySelector('.file-drop input[type=file]'), dt = new DataTransfer()
 dt.items.add(new File(['API'], 'api.txt', { type: 'text/plain' }))
 fileInput.files = dt.files; fileInput.dispatchEvent(new Event('change', { bubbles: true }))
 await until(() => button('Открыть api.txt'))
 await click('Открыть api.txt')
 await until(() => document.querySelector('pre')?.textContent === 'API')
 await click('Закрыть файл')
 input('.new-chat textarea', 'Analyze')
 await click('Отправить')
 await until(() => db.runs.length === 1)
 await until(() => db.chats.chat1.events.length === 1)
 await click('+ Новый чат')
 input('.new-chat textarea', 'Analyze more')
 await click('Отправить')
 await until(() => db.runs.length === 2 && db.chats.chat2.events.length === 1)
 await click('Анализ 1')
 await until(() => document.querySelector('.chat-head strong')?.textContent === 'analysis')
 assert(db.chats.chat1.events.length === 1, 'Initial prompt repeated when switching chats')
 await click('Перейти к планированию →')
 await until(() => document.querySelector('.new-chat textarea')?.value === 'Составь план по анализу задачи')
 await click('Отправить')
 await until(() => db.runs.length === 3 && db.chats.chat3.events.length === 1)
 assert(db.calls.filter(c => c.path.endsWith('/runs')).at(-1).body.purpose === 'plan', 'Wrong planning launch')
 db.plan = { id: 'plan', content: '- [ ] (p1) Use [[section1/api.txt]] and [[missing]]', steps: [{ id: 'p1', index: 0, done: false, text: 'Use [[section1/api.txt]] and [[missing]]' }] }
 event({ type: 'plan_updated', taskId: 'task', steps: db.plan.steps })
 await until(() => button('section1/api.txt'))
 assert(button('missing')?.disabled, 'Broken reference not disabled')
 await click('section1/api.txt')
 await until(() => button('Анализ').classList.contains('active') && document.querySelector('pre')?.textContent === 'API')
 await click('Выполнение')
 await click('✓ Завершить')
 await until(() => !button('Выполнение'))
 assert(button('План').classList.contains('active'), 'Done execution did not redirect to plan')
 assert(!document.querySelector('.chat') && !document.querySelector('.new-chat'), 'Chats still mounted after done')
 assert(!button('Редактировать вручную'), 'Plan editing still available')
 await click('Анализ')
 assert(!document.querySelector('input[type=file]') && !button('+ Добавить исходный'), 'Analysis editing still available')
 await click('↺ Вернуть в работу')
 await until(() => button('Выполнение') && button('Анализ 1'))
 viewApp.unmount()
 await router.push('/task/task')
 viewApp = createApp(TaskView).use(pinia).use(router)
 viewApp.mount('#app')
 await until(() => button('Выполнение'))
 await click('Анализ')
 await until(() => button('Анализ 1'))
 await click('Анализ 1')
 await until(() => document.querySelector('.chat-head'))
 assert(db.chats.chat1.events.length === 1, 'Prompt repeated after reopen/remount')
 await click('Перейти к планированию →')
 await until(() => document.querySelector('.chat-pane textarea')?.value === 'Составь план по анализу задачи')
 await click('Анализ')
 await click('Ещё')
 await click('Удалить раздел')
 await until(() => !db.sections.length)
 assert(db.warnings.some(s => s.includes('p1')), 'Deletion did not warn about plan reference')
 return 'PASS: create/edit/conflict/move/upload/file/chats/planning/links/done/reopen/delete'
}
