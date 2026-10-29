const electron = require('electron')
if (typeof electron === 'string') {
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const result = require('child_process').spawnSync(electron, [__filename], { stdio: 'inherit', env })
  process.exit(result.status ?? 1)
}
const { app, BrowserWindow } = electron
const fs = require('fs'), path = require('path')
app.commandLine.appendSwitch('disable-gpu')
app.on('window-all-closed', () => {})
app.whenReady().then(async () => {
  const { createServer } = await import('vite')
  const steps = Array.from({ length: 18 }, (_, i) => ({ id: 'p' + (i + 1), index: i, text: 'Шаг ' + (i + 1) + ': подготовить интерфейс выполнения и проверить результат', done: false }))
  steps[17].done = true
  const stages = steps.slice(0, 14).map((step, i) => ({ id: 'stage-' + i, pauseAfter: false, sessions: [{ id: 'session-' + i, points: [step.id], agentId: 'agent', queueMode: 'execute', permissionPolicy: 'ask', status: 'queued' }] }))
  let browser = fs.readFileSync(path.resolve('scripts/task-analysis-browser.js'), 'utf8').split('window.runScenario = async () => {')[0]
  browser = 'import "/src/assets/main.css";\n' + browser
  browser = browser.replace('window.testDb = db;', 'db.plan = ' + JSON.stringify({ id: 'plan', content: '', steps }) + '; db.queue = ' + JSON.stringify({ taskId: 'task', projectId: 'project', status: 'idle', stageIndex: 0, stages, history: [] }) + '; window.testDb = db;')
  browser = browser.replace("return json({ taskId: 'task', projectId: 'project', status: 'idle', stages: [], history: [] })", "{ if (method === 'PUT') db.queue.stages = body.stages; return json(db.queue) }")
  browser = browser.replace("router.push('/task/task')", "router.push('/task/task?tab=exec')")
  browser = browser.replace("id: 'project', name: 'Test',", "id: 'project', kind: 'project', name: 'Test',")
  browser = browser.replace("if (path === '/api/agents')", `
 if (path === '/api/projects/project/git/branches' || path === '/api/projects/project/git/branches/refresh') return json([
   { name: 'main', ref: 'refs/heads/main', remote: false },
   { name: 'feature/long-branch-name-for-checking-layout', ref: 'refs/heads/feature/long-branch-name-for-checking-layout', remote: false },
   { name: 'origin/main', ref: 'refs/remotes/origin/main', remote: true },
   { name: 'origin/release', ref: 'refs/remotes/origin/release', remote: true }
 ])
 if (path === '/api/projects/project/git/settings') return json({ base_branch: 'main', branch_prefixes: ['feature', 'fix'], auto_review: false })
 if (path === '/api/projects/project/git/repository') return json({ branch: 'main', detached: false })
 if (path === base + '/queue/start') return json(db.queue)
 if (path === '/api/agents')`)
  browser += `
window.runScenario = async () => {
  await until(() => button('Выполнение'))
  await click('Выполнение')
  const plan = document.querySelector('.execution-plan'), overview = document.querySelector('.queue-overview')
  await until(() => visible(overview) && overview.querySelectorAll('.session').length === 14)
  assert(!document.querySelector('.agent-view'), 'Queue should be the default view')
  overview.querySelector('.review-slot').click()
  await until(() => overview.querySelector('.stage.final'))
  overview.querySelector('.stage.final [title="Убрать финальное ревью из очереди"]').click()
  await until(() => !overview.querySelector('.stage.final') && overview.querySelector('.review-slot'))
  assert(db.queue.stages.length === 14, 'Removing final review should preserve other stages')
  assert(!db.queue.stages.some(stage => stage.sessions.some(session => session.kind === 'review')), 'Review removal should be persisted')
  await click('Изменить ветку')
  await until(() => document.querySelector('.branch-editor input[aria-label="Имя новой ветки"]'))
  await until(() => document.querySelector('.branch-editor input[aria-label="Базовая ветка"]').value === 'origin/main')
  input('.branch-editor input[aria-label="Имя новой ветки"]', 'queue-ui')
  await click('Готово')
  assert(document.querySelector('.branch-summary code').textContent === 'queue-ui', 'Branch summary should update')
  await click('▶ Запустить')
  await until(() => document.querySelector('.modal input[aria-label="Имя новой ветки"]'))
  assert(document.querySelector('.modal input[aria-label="Имя новой ветки"]').value === 'queue-ui', 'Launch dialog should use selected branch')
  await click('Отмена')
  await click('Изменить ветку')
  document.querySelectorAll('.branch-editor .where-kinds button')[1].click()
  await until(() => document.querySelector('.branch-editor [aria-label="Поиск ветки"]'))
  input('.branch-editor [aria-label="Поиск ветки"]', 'release')
  await until(() => document.querySelectorAll('.branch-editor .where-item').length === 1)
  document.querySelector('.branch-editor .where-item').click()
  await until(() => document.querySelector('.branch-editor .where-selection code')?.textContent === 'release')
  await click('Готово')
  await click('▶ Запустить')
  await until(() => document.querySelector('.modal .where-selection code')?.textContent === 'release')
  await click('Начать выполнение')
  await until(() => !document.querySelector('.modal'))
  const launch = db.calls.find(call => call.path.endsWith('/queue/start'))
  assert(launch?.body.place === 'existing' && launch.body.branch === 'release', 'Start should receive the chosen existing branch')
  if (innerWidth > 820) assert(plan.getBoundingClientRect().right <= overview.getBoundingClientRect().left + 1, 'Plan and queue should be side by side')
  const free = plan.querySelectorAll('.step')[15]
  free.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }))
  await until(() => free.getAttribute('aria-checked') === 'true')
  const card = overview.querySelector('.session')
  card.querySelector('[title="Настройки шага"]').click()
  await until(() => card.querySelector('.settings'))
  overview.scrollTop = 180
  const before = overview.scrollTop
  const opener = card.querySelector('.session-open')
  opener.focus({ preventScroll: true }); opener.click()
  await until(() => document.querySelector('.agent-view'))
  assert(!visible(overview), 'Queue hidden while the agent is open')
  assert(document.activeElement.textContent.includes('К очереди'), 'Focus should move to back button')
  await click('К очереди')
  assert(document.querySelector('.queue-overview') === overview, 'Queue should stay mounted')
  assert(overview.scrollTop === before, 'Queue scroll should survive')
  assert(card.querySelector('.settings'), 'Expanded settings should survive')
  assert(document.activeElement === opener, 'Focus should return to the opener')
  assert(free.getAttribute('aria-checked') === 'true', 'Plan selection should survive')
  const last = overview.querySelectorAll('.session')[13]
  last.click()
  await until(() => document.querySelector('.agent-view'))
  await click('К очереди')
  assert(visible(overview), 'Card click should support returning')
  free.click()
  plan.querySelectorAll('.step')[17].click()
  await until(() => button('Вернуть в работу'))
  assert(button('Вернуть в работу').getBoundingClientRect().height <= 22, 'Return action should keep its compact size')
  const branchBox = overview.querySelector('.execution-branch').getBoundingClientRect()
  assert(branchBox.height <= 38, 'Collapsed branch should fit a compact row')
  assert(branchBox.bottom + 8 <= overview.querySelector('.queue-head').getBoundingClientRect().top, 'Branch and queue controls should be separated')
  assert(document.documentElement.scrollWidth <= innerWidth, 'No horizontal page overflow')
  return 'PASS: branch discovery, new and existing branch selection, launch uses chosen branch; queue navigation, keyboard and preserved state'
}
`
  const testPath = path.resolve('client/.execution-test.js')
  fs.writeFileSync(testPath, browser)
  const html = '<!doctype html><html><body><div id="app"></div><script type="module" src="/.execution-test.js"></script></body></html>'
  const server = await createServer({ configFile: path.resolve('client/vite.config.ts'), server: { host: '127.0.0.1', port: 5191 }, plugins: [{
    name: 'execution-test', configureServer(vite) { vite.middlewares.use(async (req, res, next) => {
      if (req.url !== '/__execution_test__') return next()
      try { res.setHeader('Content-Type', 'text/html'); res.end(await vite.transformIndexHtml('/__execution_test__', html)) } catch (error) { next(error) }
    }) }
  }] })
  let win, exitCode = 1
  try {
    await server.listen()
    win = new BrowserWindow({ show: false, width: 1440, height: 960, webPreferences: { sandbox: true, contextIsolation: true, partition: 'execution-test-' + Date.now() } })
    await win.webContents.session.setProxy({ mode: 'direct' })
    win.webContents.on('console-message', (_event, level, message) => { if (level >= 2) console.log(message) })
    await win.loadURL('http://127.0.0.1:' + server.httpServer.address().port + '/__execution_test__')
    const deadline = Date.now() + 20000
    while (!await win.webContents.executeJavaScript('!!window.ready')) {
      if (Date.now() > deadline) throw new Error('Browser setup timed out')
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    console.log(await win.webContents.executeJavaScript('window.runScenario()'))
    await new Promise(resolve => setTimeout(resolve, 100))
    const screenshot = path.join(require('os').tmpdir(), 'plangent-execution-desktop.png')
    fs.writeFileSync(screenshot, (await win.webContents.capturePage()).toPNG())
    console.log('Screenshot: ' + screenshot)
    win.setSize(720, 900)
    await new Promise(resolve => setTimeout(resolve, 250))
    console.log(await win.webContents.executeJavaScript(`(async () => {
      const assert = (ok, message) => { if (!ok) throw new Error(message) }
      const visible = el => el && el.getClientRects().length > 0
      const until = async check => { const end = Date.now() + 5000; while (!check()) { if (Date.now() > end) throw new Error('Timed out'); await new Promise(r => setTimeout(r, 30)) } }
      const click = async text => { [...document.querySelectorAll('button')].find(el => visible(el) && el.textContent.trim() === text).click(); await new Promise(r => setTimeout(r, 60)) }
      const plan = document.querySelector('.execution-plan'), overview = document.querySelector('.queue-overview')
      assert(plan.getBoundingClientRect().bottom <= overview.getBoundingClientRect().top + 1, 'Narrow layout should stack plan above queue')
      document.querySelector('.session-open').click()
      await until(() => document.querySelector('.agent-view'))
      assert(!visible(plan), 'Narrow agent view should use the full area')
      await click('К очереди')
      assert(visible(plan) && visible(overview), 'Back should restore narrow plan and queue')
      assert(document.documentElement.scrollWidth <= innerWidth, 'No narrow horizontal overflow')
      return 'PASS: narrow layout, agent view, return to plan and queue'
    })()`))
    exitCode = 0
  } catch (error) { console.error(error) }
  finally { if (fs.existsSync(testPath)) fs.unlinkSync(testPath); win?.destroy(); await server.close(); app.exit(exitCode) }
}).catch(error => { console.error(error); app.exit(1) })
