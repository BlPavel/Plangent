const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { parseHTML } = require('linkedom');
const { window } = parseHTML('<html><body><div id="app"></div></body></html>');
for (const key of ['window', 'document', 'HTMLElement', 'SVGElement', 'Element', 'Node']) global[key] = window[key];
Object.defineProperty(window.HTMLElement.prototype, 'open', { configurable:true, get() { return this.hasAttribute('open'); }, set(value) { if (value) this.setAttribute('open',''); else this.removeAttribute('open'); } });
global.requestAnimationFrame = callback => setTimeout(callback, 0);
global.cancelAnimationFrame = clearTimeout;
global.getComputedStyle = () => ({ transitionDelay: '0s', transitionDuration: '0s', animationDelay: '0s', animationDuration: '0s' });
window.getComputedStyle = global.getComputedStyle;
window.HTMLElement.prototype.scrollIntoView = function () {};
global.location = { protocol: 'http:', host: 'localhost' };
const sockets = [];
global.WebSocket = class {
  static OPEN = 1;
  readyState = 1;
  constructor() { sockets.push(this); }
  send() {}
  close() {}
};
const { createApp, h, ref, nextTick } = require('vue');
const { build } = require('esbuild');
const { parse, compileScript } = require('@vue/compiler-sfc');
async function component(file) {
  const bundle = await build({
    entryPoints: [path.resolve(file)], bundle: true, write: false, platform: 'node', format: 'cjs',
    external: ['vue'], loader: { '.css': 'empty' }, alias: { '@core': path.resolve('client/src/core'), '@shared': path.resolve('client/src/shared') },
    plugins: [{ name: 'vue-test', setup(build) {
      build.onResolve({ filter: /^@features\/(agents|agent-chat)$/ }, args => ({ path: args.path, namespace: 'mock' }));
      build.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({ contents: `
        export const useAgentsStore = () => ({ agents: [{id: 'agent', name: 'Test Agent'}] });
        export const useChatStore = () => ({ sessions: [{id: 'session', agent_id: 'agent', model: 'saved-model', metadata: {reasoningEffort: 'high'}}],
          agentOptions: { agent: {} }, fetchAgentOptions: async () => {} });
        export const modelAndEffort = () => ({models: [{value:'saved-model',label:'Saved model'}], efforts:[{value:'high',label:'High'}]});
      `, loader: 'js' }));
      build.onLoad({ filter: /\.vue$/ }, args => {
        const { descriptor } = parse(fs.readFileSync(args.path, 'utf8'), { filename: args.path });
        return { contents: compileScript(descriptor, { id: args.path, inlineTemplate: true }).content, loader: 'ts', resolveDir: path.dirname(args.path) };
      });
    }}],
  });
  const mod = new Module(path.resolve('scripts/.plan-review-ui.cjs'), module);
  mod.filename = path.resolve('scripts/.plan-review-ui.cjs'); mod.paths = module.paths;
  mod._compile(bundle.outputFiles[0].text, mod.filename);
  return mod.exports.default;
}
async function flush() { await new Promise(r => setTimeout(r, 15)); await nextTick(); }
function button(text, root = document) {
  const value = [...root.querySelectorAll('button')].find(b => b.textContent.trim() === text);
  assert.ok(value, 'button: ' + text); return value;
}
async function click(text, root) { button(text, root).click(); await flush(); }
async function submit(root, text) {
  const field = root.querySelector('textarea'); field.value = text;
  field.dispatchEvent(new window.Event('input', {bubbles:true}));
  await nextTick();
  root.querySelector('form').dispatchEvent(new window.Event('submit', {bubbles:true,cancelable:true}));
  await flush();
}
test('plan review UI decisions, delivery, live remapping, answers, another round and queue lock', async () => {
  const calls = [], highlights = [], counts = [];
  let reviews = [{ id:'r1', task_id:'t', round:1, plan_version:1, session_id:'session', skill_id:'skill', overview:'Summary', coverage:[
    {requirement:'A requirement',steps:['p1'],status:'partial',remark_id:'one'}], status:'completed' }];
  const makeRemark = (id, step) => ({id, steps:[{id:step,deleted:false}],kind:'coverage',text:'Card '+id,suggestion:'Fix it',
    status:'open',decision:'',outdated:false,applied_version:null,messages:[]});
  let detail = {review:reviews[0], remarks:[makeRemark('one','p1'),makeRemark('two','p2'),makeRemark('three','p3')]};
  global.fetch = async (url, options) => {
    const input = options.body ? JSON.parse(options.body) : undefined;
    calls.push({url, input, method:options.method});
    let result;
    if (url.endsWith('/plan-reviews')) result = reviews;
    else if (url.endsWith('/skills')) result = [{id:'skill',title:'Plan skill',origin:'direct'}];
    else if (url.endsWith('/planners')) result = {sessions:[{id:'planner',title:'Author planner',available:true}],default_session_id:'planner'};
    else if (url.endsWith('/decision')) {
      const id = url.split('/').at(-2), card = detail.remarks.find(r => r.id === id);
      card.status = input.status; card.decision = input.comment;
      if (input.comment) card.messages.push({id:'m'+calls.length,author:'developer',text:input.comment,sent:false});
      result = detail;
    } else if (url.endsWith('/send')) {
      assert.equal(input.session_id,'planner');
      for (const card of detail.remarks) if (['accepted','discussing'].includes(card.status)) card.status = 'sent';
      result = detail;
    } else if (url.endsWith('/launch')) {
      assert.equal(input.agent_id,'agent'); assert.equal(input.model,'saved-model'); assert.equal(input.reasoning_effort,'high');
      assert.equal(input.skill_id,'skill');
      const review = {...reviews[0],id:'r2',round:2,status:'open'};
      reviews = [review,...reviews]; detail = {review, remarks:[]}; result = detail;
    } else if (url.endsWith('/r1') || url.endsWith('/r2')) result = detail;
    else throw Error('Unexpected '+url);
    return new Response(JSON.stringify(result),{status:200,headers:{'Content-Type':'application/json'}});
  };
  const Panel = await component('client/src/features/tasks/components/plan-review/PlanReviewPanel.vue');
  const locked = ref(false);
  const app = createApp({render:()=>h(Panel,{projectId:'p',taskId:'t',defaultAgentId:'agent',locked:locked.value,readonly:false,
    onHighlight:ids=>highlights.push(ids),onCounts:value=>counts.push(value)})});
  app.mount('#app'); await flush(); await flush();
  assert.match(document.body.textContent,/A requirement/);
  assert.deepEqual(counts.at(-1),{p1:1,p2:1,p3:1});
  await click('→ замечание 1'); assert.deepEqual(highlights.at(-1),['p1']);
  let cards = document.querySelectorAll('.remark');
  await click('Принять', cards[0]); await submit(cards[0],'After p2');
  await click('Обсудить', cards[1]); await submit(cards[1],'Why this order?');
  await click('Отклонить', cards[2]); await submit(cards[2],'Intentional scope');
  assert.equal(document.querySelectorAll('.remark')[2].querySelector('details').hasAttribute('open'), false);
  assert.match(document.body.textContent,/Отправить планировщику \(2\)/);
  await click('Отправить планировщику (2)'); await click('Отправить');
  assert.equal(calls.filter(c=>c.url.endsWith('/send')).length,1);
  // A sent card is never a dead end: it can be reopened or discussed again.
  assert.ok(button('Вернуть', document.querySelectorAll('.remark')[0])); assert.ok(button('Обсудить', document.querySelectorAll('.remark')[0]));
  assert.equal([...document.querySelectorAll('.remark button')].some(b => b.textContent.trim() === 'Комментарий…'), false);
  assert.match(document.body.textContent, /Отправлено планировщику/);
  detail.remarks[0].steps = [{id:'p7',deleted:false}];
  detail.remarks[0].status = 'applied'; detail.remarks[0].outdated = true; detail.remarks[0].applied_version = 2;
  detail.remarks[1].steps = [{id:'p8',deleted:false}]; detail.remarks[1].status = 'answered';
  detail.remarks[1].messages.push({id:'answer',author:'planner',text:'Planner answer',sent:true});
  detail.remarks.push(makeRemark('four','p9'));
  sockets[0].onmessage({data:JSON.stringify({type:'plan_review_updated',taskId:'t'})});
  await flush(); await flush();
  assert.match(document.body.textContent,/Planner answer/);
  assert.match(document.body.textContent,/Учтено в плане/);
  assert.match(document.body.textContent,/к прежней редакции плана/);
  assert.match(document.body.textContent,/Планировщик ответил/);
  assert.deepEqual(counts.at(-1),{p9:1});
  cards = document.querySelectorAll('.remark');
  const stepButton = [...cards[0].querySelectorAll('button')].find(b=>b.textContent.trim()==='p7');
  stepButton.click(); await flush(); assert.deepEqual(highlights.at(-1),['p7']);
  locked.value = true; await flush();
  assert.equal(button('Ревью ещё раз').disabled,true);
  assert.equal(button('Отправить планировщику (0)').disabled,true);
  assert.equal([...document.querySelectorAll('.remark button')].some(b=>b.textContent==='Принять'),false);
  locked.value = false; await flush();
  await click('Ревью ещё раз'); await click('Запустить ревью');
  assert.match(document.body.textContent,/Ревью выполняется/);
  assert.equal(calls.filter(c=>c.url.endsWith('/launch')).length,1);
  app.unmount();
});

