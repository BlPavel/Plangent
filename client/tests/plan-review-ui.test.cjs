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
const { createPinia, setActivePinia } = require('pinia');
require('node:test').beforeEach(() => setActivePinia(createPinia()));
const { build } = require('esbuild');
const { parse, compileScript } = require('@vue/compiler-sfc');
async function component(file) {
  const bundle = await build({
    entryPoints: [path.resolve(file)], bundle: true, write: false, platform: 'node', format: 'cjs',
    external: ['vue', 'pinia'], loader: { '.css': 'empty' }, alias: { '@core': path.resolve('client/src/core'), '@shared': path.resolve('client/src/shared') },
    plugins: [{ name: 'vue-test', setup(build) {
      build.onResolve({ filter: /^@features\/(agents|agent-chat)$/ }, args => ({ path: args.path, namespace: 'mock' }));
      build.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({ contents: `
        export const ChatComposer = { setup(_, { expose }) { expose({ content: () => [], clear: () => {} }); return () => null; } };
        export const useAgentsStore = () => ({ agents: [{id: 'agent', name: 'Test Agent'}] });
        export const useChatStore = () => ({ sessions: globalThis.reviewTestSessions ?? [{id: 'session', agent_id: 'agent', model: 'saved-model', metadata: {reasoningEffort: 'high'}}],
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
    else if (url.endsWith('/recipients')) result = { sessions: [{ id: 'planner', title: 'Planner', available: true, busy: false }], default_session_id: 'planner' };
    else if (url.endsWith('/decision')) {
      const id = url.split('/').at(-2), card = detail.remarks.find(r => r.id === id);
      card.status = input.status; card.decision = input.comment;
      if (input.comment) card.messages.push({id:'m'+calls.length,author:'developer',text:input.comment,sent:false});
      result = detail;
    } else if (url.endsWith('/discuss')) {
      for (const card of detail.remarks) for (const message of card.messages) message.sent = true;
      result = detail;
    } else if (url.endsWith('/send')) {
      for (const card of detail.remarks) if (['accepted','discussing'].includes(card.status)) { card.status = 'sent'; card.planner_session_id = 'planner'; }
      result = detail;
    } else if (url.endsWith('/launch')) {
      assert.equal(input.agent_id,'agent'); assert.equal(input.model,'saved-model'); assert.equal(input.reasoning_effort,'high');
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
  let cards = document.querySelectorAll('article');
  await click('Принять', cards[0]); await submit(cards[0],'After p2');
  // Discussion is with the reviewer; rejecting needs no reason and no form.
  await click('Обсудить', cards[1]); await submit(cards[1],'Why this order?');
  await click('Отклонить', cards[2]);
  const rejection = calls.filter(c => c.url.endsWith('/decision')).at(-1).input;
  assert.equal(rejection.status, 'rejected'); assert.equal(rejection.comment, '');
  assert.equal(document.querySelectorAll('article')[2].querySelector('form'), null);
  // The comment waits in its card until it is sent to the reviewer with the batch button.
  assert.equal(calls.filter(c => c.url.endsWith('/discuss')).length, 0);
  assert.match(document.body.textContent, /Ждёт отправки/);
  await click('Отправить ревьюеру (1)');
  assert.equal(calls.filter(c => c.url.endsWith('/discuss')).length, 1);
  assert.doesNotMatch(document.body.textContent, /Ждёт отправки/);
  // Nothing goes to the planner while a card is still being discussed.
  assert.equal(button('Отправить планировщику (1)').disabled, true);
  await click('Принять', document.querySelectorAll('article')[1]); await submit(document.querySelectorAll('article')[1],'Then fix the order');
  assert.equal(button('Отправить планировщику (2)').disabled, false);
  await click('Отправить планировщику (2)');
  await click('Отправить');
  assert.equal(calls.filter(c=>c.url.endsWith('/send')).length,1);
  // A sent card is never a dead end: it can be reopened.
  assert.ok(button('Вернуть', document.querySelectorAll('article')[0]));
  assert.equal([...document.querySelectorAll('article button')].some(b => b.textContent.trim() === 'Комментарий…'), false);
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
  assert.doesNotMatch(document.body.textContent,/к прежней редакции плана/);
  assert.match(document.body.textContent,/Открыть чат планировщика/);
  assert.match(document.body.textContent,/Планировщик ответил/);
  assert.deepEqual(counts.at(-1),{p9:1});
  cards = document.querySelectorAll('article');
  const appliedGroup = document.querySelector('.applied-remarks');
  assert.equal(appliedGroup.open, false);
  assert.equal(appliedGroup.querySelector('summary').textContent, 'Учтено (1)');
  assert.match(cards[0].textContent, /Card two/);
  assert.match(appliedGroup.querySelector('article').textContent, /Card one/);
  // Coverage links reveal the original card even after it moves into the collapsed group.
  document.querySelector('.table-wrap button').click(); await flush();
  assert.equal(appliedGroup.open, true);
  const stepButton = [...appliedGroup.querySelectorAll('button')].find(b=>b.textContent.trim()==='p7');
  stepButton.click(); await flush(); assert.deepEqual(highlights.at(-1),['p7']);
  locked.value = true; await flush();
  assert.equal([...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Новый раунд'), false);
  assert.equal(button('Отправить планировщику (0)').disabled,true);
  assert.equal([...document.querySelectorAll('article button')].some(b=>b.textContent==='Принять'),false);
  locked.value = false; await flush();
  await click('Новый раунд'); await click('Запустить новый раунд');
  assert.match(document.body.textContent,/Ревью выполняется/);
  assert.equal(calls.filter(c=>c.url.endsWith('/launch')).length,1);
  app.unmount();
});

test('review of a QA document: its own words, identifiers and quotes on cards, no coverage table, target in requests', async () => {
  const urls = [], highlights = [];
  const review = { id:'q1', task_id:'t', target:'qa', round:1, plan_version:3, session_id:'session', skill_id:null, overview:'QA summary', coverage:[], status:'completed' };
  const card = (id, steps, extra) => ({ id, steps, kind:'contradiction', text:'Card '+id, suggestion:'', status:'open', decision:'', outdated:false, applied_version:null, messages:[], quote:'', ...extra });
  const detail = { review, remarks:[card('one',[{id:'Q4',deleted:false}]), card('two',[],{kind:'suggestion',quote:'A free paragraph'})] };
  global.fetch = async url => {
    urls.push(url);
    let result;
    if (url.endsWith('/plan-reviews?target=qa')) result = [review];
    else if (url.endsWith('/skills?target=qa')) result = [{ id:'s1', title:'Dates', origin:'direct' }];
    else if (url.endsWith('/q1')) result = detail;
    else throw Error('Unexpected '+url);
    return new Response(JSON.stringify(result),{status:200,headers:{'Content-Type':'application/json'}});
  };
  const Panel = await component('client/src/features/tasks/components/plan-review/PlanReviewPanel.vue');
  const app = createApp({render:()=>h(Panel,{projectId:'p',taskId:'t',target:'qa',defaultAgentId:'agent',locked:true,readonly:false,onHighlight:ids=>highlights.push(ids)})});
  app.mount('#app'); await flush(); await flush();
  const text = document.body.textContent;
  assert.match(text, /Ревью QA/);
  assert.match(text, /Документ заморожен/);
  assert.doesNotMatch(text, /Покрытие материалов/);
  assert.doesNotMatch(text, /планировщик/i);
  assert.match(text, /QA summary/);
  assert.match(text, /Улучшение/);
  assert.match(text, /A free paragraph/);
  assert.ok(urls.every(url => url.includes('?target=qa') || url.endsWith('/q1')), urls.join('\n'));
  assert.equal(button('Отправить автору документа (0)').disabled, true);
  button('Q4').click(); await flush(); assert.deepEqual(highlights.at(-1), ['Q4']);
  app.unmount();
});


test('completed preparation reviews show card activity only for a sent unanswered discussion', async () => {
  const { reactive } = require('vue');
  for (const target of ['architecture', 'qa', 'plan']) {
    globalThis.reviewTestSessions = reactive([{ id: 'session', agent_id: 'agent', status: 'thinking', metadata: {} }]);
    const review = { id: 'activity', task_id: 't', target, round: 1, session_id: 'session', status: 'completed', coverage: [], overview: 'Finished report' };
    const remark = { id: 'card', steps: [], kind: 'risk', text: 'Check', suggestion: '', status: 'open', decision: '', messages: [] };
    global.fetch = async url => new Response(JSON.stringify(url.includes('/activity') ? { review, remarks: [remark] } : [review]), { status: 200 });
    const Panel = await component('client/src/features/tasks/components/plan-review/PlanReviewPanel.vue');
    const app = createApp({ render: () => h(Panel, { projectId: 'p', taskId: 't', target, locked: true, readonly: false }) });
    app.mount('#app');
    try {
      await flush(); await flush();
      const activity = () => document.querySelector('.activity')?.textContent || '';
      assert.equal(activity(), '', target + ': the report turn is still finishing');
      remark.status = 'discussing'; remark.messages = [{ id: 'question', author: 'developer', text: 'Why?', sent: false }];
      const refresh = async () => { for (const socket of sockets) socket.onmessage?.({ data: JSON.stringify({ type: 'plan_review_updated', taskId: 't' }) }); await flush(); await flush(); };
      await refresh(); assert.equal(activity(), '', 'an unsent question is not an answer in progress');
      remark.messages[0].sent = true;
      await refresh(); assert.ok(activity(), target + ': the reviewer is answering a sent question');
      remark.messages.push({ id: 'answer', author: 'reviewer', text: 'Because', sent: true });
      await refresh(); assert.equal(activity(), '', 'a recorded answer ends card activity before the turn ends');
    } finally { app.unmount(); delete globalThis.reviewTestSessions; }
  }
});
