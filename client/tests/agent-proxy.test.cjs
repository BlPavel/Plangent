const { test } = require('node:test')
const assert = require('node:assert/strict')
const { parseHTML } = require('linkedom')
const { window } = parseHTML('<html><body><div id="app"></div></body></html>')
for (const key of ['window', 'document', 'HTMLElement', 'SVGElement', 'Element', 'Node']) global[key] = window[key]
const { createApp, nextTick } = require('vue')
const { loader } = require('./client-test-loader.cjs')

const flush = async () => { await new Promise(resolve => setTimeout(resolve, 0)); await nextTick() }
function button(text) { const element = [...document.querySelectorAll('button')].find(element => element.textContent.trim() === text); assert.ok(element, text); return element }
async function field(label, value) {
  const element = [...document.querySelectorAll('label')].find(element => element.textContent === label)
  assert.ok(element, label)
  const input = document.getElementById(element.getAttribute('for'))
  input.value = value; input.dispatchEvent(new window.Event('input', { bubbles: true })); await flush()
}

test('proxy form preserves write-only credentials, saves replacements and reports connection failures', async t => {
  const writes = []
  let checks = 0
  const load = loader({ '../api': { settingsEndpoints: {
    getAgentProxy: async () => ({ url: 'http://proxy.company:8080', username: 'employee', hasPassword: true }),
    putAgentProxy: async ({ body }) => { writes.push(body); return { url: body.url, username: body.username, hasPassword: body.password !== '' } },
    checkAgentProxy: async () => { checks++; return { ok: false, results: [{ host: 'api.openai.com', ok: false, error: 'Прокси недоступен' }] } },
  } } })
  const app = createApp(load('client/src/features/settings/components/AgentProxySettings.vue').default)
  app.mount('#app'); t.after(() => app.unmount()); await flush()
  const password = document.querySelector('input[type="password"]')
  assert.equal(password.value, '')
  assert.equal(password.placeholder, 'Пароль сохранён')
  await field('Логин', 'another-employee')
  assert.equal(button('Проверить подключение').disabled, true)
  button('Сохранить').click(); await flush()
  assert.equal(writes.length, 1); assert.equal(Object.hasOwn(writes[0], 'password'), false)
  await field('Пароль', 'new-private-password')
  button('Сохранить').click(); await flush()
  assert.equal(writes[1].password, 'new-private-password')
  assert.equal(password.value, '', 'clear the secret after saving')
  button('Проверить подключение').click(); await flush()
  assert.equal(checks, 1)
  assert.match(document.querySelector('[role="status"]').parentElement.textContent, /Прокси недоступен/)
  button('Удалить сохранённый пароль').click(); await flush()
  button('Сохранить').click(); await flush()
  assert.equal(writes[2].password, '')
})
