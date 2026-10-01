const electron = require('electron')
if (typeof electron === 'string') {
  const testEnv = { ...process.env }
  delete testEnv.ELECTRON_RUN_AS_NODE
  const result = require('child_process').spawnSync(electron, [__filename], { stdio: 'inherit', env: testEnv })
  process.exit(result.status ?? 1)
}
const { app, BrowserWindow } = electron
app.on('window-all-closed', () => {})
const path = require('path')
app.commandLine.appendSwitch('disable-gpu')
app.whenReady().then(async () => {
  const { createServer } = await import('vite')
  const browser = require('fs').readFileSync(path.resolve('scripts/task-analysis-browser.js'), 'utf8')
  const testPath = path.resolve('client/.analysis-test.js')
  require('fs').writeFileSync(testPath, browser)
  const testPage = '<!doctype html><html><body><div id="app"></div><script>window.onerror=(...args)=>console.log(args[0]);window.onunhandledrejection=e=>console.log(String(e.reason))</script><script type="module" src="/.analysis-test.js"></script></body></html>'
  const server = await createServer({ configFile: path.resolve('client/vite.config.ts'), server: { port: 5189, host: '127.0.0.1' }, plugins: [{
    name: 'task-analysis-test',
    configureServer(vite) { vite.middlewares.use(async (req, res, next) => {
      if (req.url !== '/__test__') return next()
      try { res.setHeader('Content-Type', 'text/html'); res.end(await vite.transformIndexHtml('/__test__', testPage)) }
      catch (e) { next(e) }
    }) }
  }] })
  await server.listen()
  const window = new BrowserWindow({ show: false, width: 1400, height: 900, webPreferences: { sandbox: true, contextIsolation: true, partition: 'analysis-test-' + Date.now() } })
  window.webContents.on('console-message', (_event, level, message) => { console.log(message) })
  let exitCode = 1
  try {
    const port = server.httpServer.address().port
    await window.webContents.session.setProxy({mode:'direct'})
    await window.loadURL('http://127.0.0.1:' + port + '/__test__')
    const deadline = Date.now() + 20000
    while (!await window.webContents.executeJavaScript('!!window.ready')) {
      if (Date.now() > deadline) throw new Error('Browser setup timed out: ' + await window.webContents.executeJavaScript('document.documentElement.outerHTML'))
      await new Promise(r => setTimeout(r, 100))
    }
    console.log(await window.webContents.executeJavaScript('window.runScenario()'))
    exitCode = 0
  } catch (e) { console.error(e); exitCode = 1 }
  finally { require('fs').unlinkSync(testPath); window.destroy(); await server.close(); app.exit(exitCode) }
}).catch(e => { console.error(e); app.exit(1) })
