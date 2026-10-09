
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { parseHTML } = require('linkedom');
const { window } = parseHTML('<html><body><div id="app"></div></body></html>');
for (const key of ['window', 'document', 'Document', 'ShadowRoot', 'HTMLElement', 'SVGElement', 'Element', 'Node']) global[key] = window[key];
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
    loader: { '.md': 'text', '.css': 'empty' }, // Match Vite's bundled Markdown ?raw imports.
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



test('task MR UI edits agent draft and target, confirms publication, refreshes status without polling',async()=>{
 const calls=[],head='a'.repeat(40),prefix='/api/projects/p/task-mr';let state='opened';
 global.fetch=async(url,options={})=>{
  const body=options.body?JSON.parse(options.body):undefined;calls.push({url,body});let result;
  if(url==='/api/projects/p/tasks/t')result={id:'t',key:'Local-1',branch_name:'feature/task',status:'open',mr_link:JSON.stringify({iid:5,url:'https://gitlab.test/team/repo/-/merge_requests/5',state:'opened'})};
  else if(url===prefix+'/refresh')result={iid:5,web_url:'https://gitlab.test/team/repo/-/merge_requests/5',state};
  else if(url===prefix+'/preview')result={head,task_id:'t',source_branch:'feature/task',target_branch:'main',connection_id:'c',project_path:'team/repo',title:'PROJ-123 Task',description:'Template draft',reviewer_ids:[12],labels:'backend',remove_source_branch:true,squash:false};
  else if(url==='/api/projects/p/git/branches')result=[{name:'main',ref:'refs/heads/main'},{name:'origin/release',ref:'refs/remotes/origin/release'}];
  else if(url===prefix+'/describe')result={description:'Agent description'};
  else if(url===prefix+'/create'){assert.equal(body.confirmed,true);assert.equal(body.title,'PROJ-123 Human title');assert.equal(body.description,'Human edited description');assert.equal(body.target_branch,'release');assert.deepEqual(body.reviewer_ids,[12,34]);result={iid:5,web_url:'https://gitlab.test/team/repo/-/merge_requests/5',state:'opened'}}
  else throw Error('Unexpected '+url);
  return new Response(JSON.stringify(result),{status:200,headers:{'Content-Type':'application/json'}})
 };
 const Panel=await component('client/src/features/task-mr/components/TaskMrPanel.vue'),pinia=createPinia(),app=createApp(Panel,{projectId:'p',taskId:'t'}).use(pinia);app.mount('#app');await flush();await flush();
 assert.match(document.body.textContent,/Открыт/);assert.equal(calls.filter(c=>c.url.endsWith('/refresh')).length,1);
 const set=async(label,value)=>{const el=[...document.querySelectorAll('label')].find(l=>l.textContent.startsWith(label)).querySelector('input,textarea');el.value=value;el.dispatchEvent(new window.Event('input',{bubbles:true}));await flush()};
 await click('Создать МР');await flush();assert.equal(document.querySelector('textarea').value,'Agent description');assert.equal(calls.filter(c=>c.url.endsWith('/create')).length,0);
 await set('Заголовок','PROJ-123 Human title');await set('Описание','Human edited description');await set('Целевая ветка','release');await set('Ревьюеры','12, 34');
 document.querySelector('form').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));await flush();assert.ok(pinia._s.get('app').confirmState);assert.match(pinia._s.get('app').confirmState.message,/release/);assert.equal(calls.filter(c=>c.url.endsWith('/create')).length,0);
 pinia._s.get('app').resolveConfirm(false);await flush();assert.ok(document.querySelector('form'));assert.equal(calls.filter(c=>c.url.endsWith('/create')).length,0);
 document.querySelector('form').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));await flush();pinia._s.get('app').resolveConfirm(true);await flush();await flush();assert.equal(calls.filter(c=>c.url.endsWith('/create')).length,1);assert.equal(document.querySelector('form'),null);
 assert.equal(document.querySelector('a').getAttribute('href'),'https://gitlab.test/team/repo/-/merge_requests/5');state='merged';await click('Обновить статус МР');assert.match(document.body.textContent,/Влит/);
 const count=calls.length;await new Promise(resolve=>setTimeout(resolve,80));assert.equal(calls.length,count,'no background polling');app.unmount();
});
