
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { parseHTML } = require('linkedom');
const { window } = parseHTML('<html><body><div id="app"></div></body></html>');
for (const key of ['window', 'document', 'HTMLElement', 'SVGElement', 'Element', 'Node']) global[key] = window[key];
Object.defineProperty(window.HTMLSelectElement.prototype, 'value', { configurable: true, get() { return this.querySelector('option[selected]')?.getAttribute('value') || ''; }, set(value) { for (const option of this.querySelectorAll('option')) { if (option.getAttribute('value') === value) option.setAttribute('selected', ''); else option.removeAttribute('selected'); } } });
global.requestAnimationFrame = callback => setTimeout(callback, 0);
global.cancelAnimationFrame = clearTimeout;
global.getComputedStyle = () => ({ transitionDelay: '0s', transitionDuration: '0s', animationDelay: '0s', animationDuration: '0s' });
window.getComputedStyle = global.getComputedStyle;
const { createApp, h, ref, nextTick } = require('vue');
const { createPinia } = require('pinia');
const { build } = require('esbuild');
const { parse, compileScript } = require('@vue/compiler-sfc');

async function component(file) {
  const bundle = await build({
    entryPoints: [path.resolve(file)], bundle: true, write: false, platform: 'node', format: 'cjs',
    external: ['vue', 'pinia'],
    loader: { '.md': 'text' }, // Match Vite's bundled Markdown ?raw imports.
    alias: { '@core': path.resolve('client/src/core'), '@shared': path.resolve('client/src/shared') },
    plugins: [{ name: 'vue-test', setup(build) { build.onLoad({ filter: /\.vue$/ }, args => {
      const { descriptor } = parse(fs.readFileSync(args.path, 'utf8'), { filename: args.path });
      const script = compileScript(descriptor, { id: args.path, inlineTemplate: true });
      return { contents: script.content, loader: 'ts', resolveDir: path.dirname(args.path) };
    }); } }],
  });
  const mod = new Module(path.resolve('scripts/.ui-test.cjs'), module);
  mod.filename = path.resolve('scripts/.ui-test.cjs'); mod.paths = module.paths;
  mod._compile(bundle.outputFiles[0].text, mod.filename);
  return mod.exports.default;
}
async function flush() { await new Promise(r => setTimeout(r, 10)); await nextTick(); }
function button(text) { const b = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === text); assert.ok(b, 'button '+text); return b; }
async function click(text) { button(text).dispatchEvent(new window.Event('click', { bubbles: true })); await flush(); }
async function field(label, value) {
  const f = [...document.querySelectorAll('.form-field')].find(f => f.querySelector('label')?.textContent === label);
  assert.ok(f, 'field '+label);
  const input = f.querySelector('input,select,textarea');
  if (input.tagName === 'SELECT') Object.defineProperty(input, 'value', { configurable: true, writable: true, value });
  else input.value = value;
  input.dispatchEvent(new window.Event(input.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); await flush();
}

test('functional connection and docs forms apply presets, save normalized data, replace passwords, probe and select branches', async () => {
  const requests = [];
  const connection = { id: 'connection', name: 'Fixture', base_url: 'https://docs.example.test', credential_mode: 'own', credential_id: 'account', organization_id: null, auth_strategy: 'basic', auth_config: { check_path: '/who' }, last_check_status: 'needs_update', last_check_message: '' };
  const config = { document_endpoint: '/doc/{id}', children: { endpoint: '/doc/{id}/children', items_path: 'items' }, fields: { id: 'id', title: 'title', body: 'body' }, link_patterns: [], body_format: 'html' };
  global.fetch = async (url, options) => {
    const body = options.body ? JSON.parse(options.body) : undefined;
    requests.push({ url, method: options.method, body });
    let response = {};
    if (url === '/api/integrations/organizations' || url === '/api/integrations/credentials') response = [];
    if (url === '/api/integrations/connections') response = options.method === 'GET' ? [connection] : connection;
    if (url === '/api/integrations/presets') response = [{ id: 'preset', name: 'Preset', description: 'Template help', auth_strategy: 'form', auth_config: { check_path: '/who', login_path: '/sign-in', username_field: 'user', password_field: 'pass' } }];
    if (url === '/api/integrations/storage') response = { available: true, insecure_dev_storage: false };
    if (url === '/api/integrations/normalize-url') response = { base_url: new URL(body.base_url).origin };
    if (url === '/api/projects/draft/docs/presets') response = [{ id: 'docs', name: 'Docs preset', description: 'Source help', config }];
    if (url === '/api/projects/draft/docs/probe') response = { urls: ['https://docs.example.test/doc/1'], fields: { id: '1', title: 'Root' }, preview: 'Preview text', missing: [] };
    if (url === '/api/projects/draft/docs/resolve') response = { id: '1', title: 'Root', url: 'https://docs.example.test/read/1' };
    if (url === '/api/projects/draft/docs/children') response = [{ id: '2', title: 'Child', url: '' }];
    return new Response(JSON.stringify(response), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const Connections = await component('client/src/features/settings/components/ConnectionsSettings.vue');
  const app = createApp(Connections).use(createPinia()); app.mount('#app'); await flush();
  await click('+ Подключение'); await click('Preset');
  await field('Название', 'My docs'); await field('Адрес сервиса', 'https://docs.example.test/read/1'); assert.ok(button('Обрезать до корня'));
  await field('Учётная запись', 'own'); await field('Собственный логин', 'reader');
  await click('Сохранить');
  const saved = requests.find(r => r.url === '/api/integrations/connections' && r.method === 'POST');
  assert.equal(saved.body.base_url, 'https://docs.example.test');
  assert.equal(saved.body.auth_config.login_path, '/sign-in');
  assert.equal(saved.body.own_credential.username, 'reader');
  assert.ok(!('password' in saved.body));
  await click('Изменить пароль'); await field('Новый пароль', 'replacement-secret'); await click('Сохранить');
  assert.equal(requests.find(r => r.url.endsWith('/connections/connection/password')).body.password, 'replacement-secret');
  assert.ok(!document.body.textContent.includes('replacement-secret'));
  app.unmount(); document.body.innerHTML = '<div id="app"></div>';
  const Docs = await component('client/src/features/projects/components/DocsSourceFields.vue');
  const model = ref({ connection_id: '', docs_config: {}, docs_selection: [] });
  const docsApp = createApp({ render: () => h(Docs, { modelValue: model.value, 'onUpdate:modelValue': v => { model.value = v; } }) }).use(createPinia());
  docsApp.mount('#app'); await flush();
  await field('Подключение', 'connection'); await click('Docs preset');
  await field('Ссылка на страницу или id документа', '1');
  await click('Пробный запрос'); assert.ok(document.body.textContent.includes('Preview text'));
  await click('Добавить раздел'); assert.equal(model.value.docs_selection[0].id, '1');
  const descendants = [...document.querySelectorAll('label')].find(l => l.textContent.includes('Со всеми дочерними')).querySelector('input');
  descendants.checked = true; descendants.dispatchEvent(new window.Event('change', { bubbles: true })); await flush();
  await click('Показать дочерние страницы');
  const exclude = [...document.querySelectorAll('label')].find(l => l.textContent.includes('Child')).querySelector('input');
  exclude.checked = false; exclude.dispatchEvent(new window.Event('change', { bubbles: true })); await flush();
  assert.deepEqual([...model.value.docs_selection[0].excluded_ids], ['2']);
  assert.equal(model.value.docs_selection[0].include_descendants, true);
  docsApp.unmount(); document.body.innerHTML = '<div id="app"></div>';
  global.location = { protocol: 'http:', host: '127.0.0.1:3001' };
  const sockets = [];
  global.WebSocket = class { constructor() { sockets.push(this); } };
  const Source = await component('client/src/features/projects/components/SourceView.vue');
  const source = ref({ id: 'docs', name: 'Docs', kind: 'source', key: 'docs', repo_path: '/managed/docs', description: '', config: {}, source_type: 'docs', sync_status: 'running', sync_stats: {} });
  const progressApp = createApp({ render: () => h(Source, { source: source.value }) }).use(createPinia());
  progressApp.mount('#app'); await flush();
  sockets[0].onmessage({ data: JSON.stringify({ type: 'docs-sync-progress', project_id: 'docs', progress: { stage: 'download', found: 4, downloaded: 2, total: 4 } }) }); await flush();
  assert.equal(document.querySelector('progress').getAttribute('value'), '2');
  assert.equal(document.querySelector('progress').getAttribute('max'), '4');
  assert.ok(button('Отменить синхронизацию'));
  source.value.sync_status = 'done'; await flush(); assert.ok(button('Обновить')); assert.ok(!document.querySelector('progress'));
  source.value.sync_status = 'running'; await flush();
  sockets[0].onmessage({ data: JSON.stringify({ type: 'docs-sync-progress', project_id: 'docs', progress: { stage: 'download', found: 1500, downloaded: 1, processed: 2, total: 12 } }) }); await flush();
  assert.equal(document.querySelector('progress').getAttribute('value'), '2');
  assert.equal(document.querySelector('progress').getAttribute('max'), '12');
  assert.ok(document.body.textContent.includes('найдено 1500'));
  assert.ok(document.body.textContent.includes('требуется загрузить 12'));
  source.value.sync_status = 'done';
  source.value.sync_stats = { code: 'confirmation_required', confirmation_count: 501, found: 1500 };
  await flush();
  assert.ok(button('Загрузить 501 документов'));
  assert.ok(document.body.textContent.includes('Найдено 1500 документов'));
  source.value.sync_stats = {};
  source.value.sync_status = 'running'; await flush();
  sockets[0].onmessage({ data: JSON.stringify({ type: 'docs-sync-progress', project_id: 'docs', progress: { stage: 'download', found: 1500, downloaded: 0, processed: 0, total: 0 } }) }); await flush();
  assert.ok(document.body.textContent.includes('Изменений для загрузки нет'));
  assert.ok(document.body.textContent.includes('требуется загрузить 0'));
  progressApp.unmount();
});
