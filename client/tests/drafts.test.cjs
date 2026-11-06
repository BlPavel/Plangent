const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const { window } = require('linkedom').parseHTML('<html><body></body></html>')
for (const key of ['window','document','HTMLElement','SVGElement','Element','Node','Document','ShadowRoot']) global[key] = window[key]
Object.defineProperty(window.HTMLTextAreaElement.prototype, 'value', { configurable: true, get() { return this.testValue ?? '' }, set(v) { this.testValue = String(v) } })
const { createApp, h, reactive, nextTick, computed } = require('vue')
const { createPinia } = require('pinia')
global.requestAnimationFrame = fn => setTimeout(fn, 0)
global.cancelAnimationFrame = clearTimeout
const { build } = require('esbuild')
const { parse, compileScript } = require('@vue/compiler-sfc')
const root = path.resolve('client/src')
const stub = 'export default { render: () => null }'
const mockSources = {
  '@features/agents': "export const useAgentsStore = () => ({ agents: [{ id: 'agent', name: 'Agent' }] }); export const permissionPolicy = () => 'ask'",
  '../composables/useAgentLaunchOptions': "import { ref } from 'vue'; export const useAgentLaunchOptions = () => ({ resolvedSelects: ref([]), state: ref(''), launch: () => ({}), pick() {}, retry() {} })",
  '../composables/useMentionFiles': "import { ref } from 'vue'; export const useMentionFiles = () => ({ files: ref([]), suggestions: ref([]), loading: ref(false), search() {}, clear() {} })",
  '@features/agent-chat': "import { ref } from 'vue'; export const SuggestMenu = { render: () => null }; export const useMentionFiles = () => ({ suggestions: ref([]), loading: ref(false), search() {}, clear() {} }); export const MessageMarkdown = { render: () => null }; export const NewChatPanel = { render: () => null }; export const useComposerReveal = () => {}",
  '../stores/code': "export const useCodeStore = () => ({ projectId: 'project', review: { id: 'review' }, files: [] })",
  '@core/api': "export const api = { get: async () => [], post: async () => ({}), patch: async () => ({}), delete: async () => undefined }; export const workspaceApi = () => api",
  './UsageMeter.vue': stub, './AgentSettingsBar.vue': stub, './SuggestMenu.vue': stub,
  './plan-review/PlanReviewPanel.vue': stub, './TaskChats.vue': stub,
  '@shared/markdown': "export const MessageMarkdown = { render: () => null }; export const DocumentLinksKey = Symbol('documentLinks')",
  '@core/stores/app': "export const useAppStore = () => ({ confirm: async () => true, toast() {} })",
}
const compiled = (async () => {
  const result = await build({ stdin: { contents: `export { default as NewChatPanel } from './features/agent-chat/components/NewChatPanel.vue'; export { default as ItemComposer } from './features/code/components/ItemComposer.vue'; export { default as PlanPanel } from './features/tasks/components/PlanPanel.vue'; export { useDraft, useDocumentDraft } from './core/composables/useDraft'; export { useDraftsStore } from './core/stores/drafts'; export { useChatDraftsStore } from './features/agent-chat/stores/drafts'; export { useWorkActions } from './features/tasks/composables/useWorkActions'; export { api as testApi } from '@core/api'; export { default as MaterialPanel } from './features/tasks/components/MaterialPanel.vue'; export { default as AnalysisSectionCard } from './features/tasks/components/AnalysisSectionCard.vue'`, resolveDir: root, loader: 'ts' }, bundle: true, write: false, loader: { '.css': 'empty', '.md': 'text' }, platform: 'node', format: 'cjs', external: ['vue','pinia'], alias: { '@core': root+'/core', '@shared': root+'/shared' }, plugins: [{ name: 'components', setup(builder) {
    builder.onResolve({ filter: /.*/ }, args => args.path in mockSources ? { path: args.path, namespace: 'mock' } : ['@features/projects', '@features/tasks'].includes(args.path) ? { path: path.resolve(root, args.path.slice(1), 'api.ts') } : undefined)
    builder.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ contents: mockSources[args.path], loader: 'ts' }))
    builder.onLoad({ filter: /\.vue$/ }, args => ({ contents: compileScript(parse(fs.readFileSync(args.path,'utf8'), { filename: args.path }).descriptor, { id: args.path, inlineTemplate: true }).content, loader: 'ts', resolveDir: path.dirname(args.path) }))
  }}] })
  const mod = new Module(__filename+'.bundle', module); mod.filename = __filename+'.bundle'; mod.paths = module.paths; mod._compile(result.outputFiles[0].text, mod.filename); return mod.exports
})()
async function mount(Component, props, pinia = createPinia()) {
  const el = document.createElement('div'); document.body.appendChild(el)
  const app = createApp({ render: () => h(Component, props) }); app.use(pinia); app.mount(el); await nextTick()
  return { el, pinia, close() { app.unmount(); el.remove() } }
}
async function type(el, value) { el.value = value; el.dispatchEvent(new window.Event('input',{bubbles:true})); await nextTick() }
function click(el) { el.dispatchEvent(new window.Event('click',{bubbles:true})); return nextTick() }
function button(el, text) { return [...el.querySelectorAll('button')].find(b=>b.textContent.trim()===text) }

test('NewChatPanel restores a draft, follows keys and protects typed or deliberately erased text from late initialText', async () => {
  const { NewChatPanel } = await compiled
  const props = reactive({ projectId:'p', draftKey:'task:a:plan-chat', title:'Plan', text:'Start', initialText:'Initial' })
  let view = await mount(NewChatPanel, props)
  try {
    await type(view.el.querySelector('textarea'),'My draft')
    props.initialText='Agent plan arrived'; await nextTick(); assert.equal(view.el.querySelector('textarea').value,'My draft')
    const pinia=view.pinia; view.close(); view=await mount(NewChatPanel,props,pinia)
    assert.equal(view.el.querySelector('textarea').value,'My draft')
    props.draftKey='task:b:plan-chat'; await nextTick(); assert.equal(view.el.querySelector('textarea').value,'Agent plan arrived')
    props.draftKey='task:a:plan-chat'; await nextTick(); assert.equal(view.el.querySelector('textarea').value,'My draft')
    await type(view.el.querySelector('textarea'),''); props.initialText='Another update'; await nextTick(); assert.equal(view.el.querySelector('textarea').value,'')
  } finally { view.close() }
})
test('ItemComposer restores input and attachments, isolates locations, clears on cancel and retains input on failed save', async () => {
  const { ItemComposer, useDraftsStore }=await compiled
  const props=reactive({ where:'a.ts:10', onSave() {} }); let view=await mount(ItemComposer,props)
  try {
    await type(view.el.querySelector('textarea'),'Review this')
    const store=useDraftsStore(view.pinia); const filesKey=Object.keys(store.drafts).find(k=>k.endsWith(':files')); store.drafts[filesKey].push({name:'image',path:'/tmp/image'})
    const pinia=view.pinia;view.close();view=await mount(ItemComposer,props,pinia)
    assert.equal(view.el.querySelector('textarea').value,'Review this');assert.match(view.el.textContent,/image/)
    view.el.querySelector('form').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));await nextTick()
    assert.equal(view.el.querySelector('textarea').value,'Review this')
    props.where='b.ts:20';await nextTick();assert.equal(view.el.querySelector('textarea').value,'')
    props.where='a.ts:10';await nextTick();assert.equal(view.el.querySelector('textarea').value,'Review this')
    await click(button(view.el,'Отмена')); view.close();view=await mount(ItemComposer,props,pinia); assert.equal(view.el.querySelector('textarea').value,'');assert.doesNotMatch(view.el.textContent,/image/)
  }finally{view.close()}
})
test('plan editor retains its source version across remounts; taking latest and cancel work',async()=>{
  const { PlanPanel, useDocumentDraft }=await compiled
  const source=reactive({text:'Original plan',version:1}); const key=reactive({id:'a'})
  const Editor={setup(){const d=useDocumentDraft(()=>`task:${key.id}:plan-edit`,()=>source);d.start();return()=>h(PlanPanel,{projectId:'p',taskId:key.id,plan:null,readonly:false,planningOpen:false,editingPlan:d.active.value,planContent:d.text.value,staleDraft:d.stale.value,checkboxLinePreviews:[],planningLive:false,selectedPlanningChat:null,planningLaunching:false,planningError:'',planningChats:[],initials:{},doneCount:0,progressPct:0,queueFrozen:false,'onUpdate:planContent':v=>{d.text.value=v},onReloadDraft:d.reload,onCancelEdit:d.cancel})}}
  let view=await mount(Editor,{})
  try{
    await type(view.el.querySelector('textarea'),'My manual edit');const pinia=view.pinia;view.close(); source.text='Updated by agent';source.version=2;view=await mount(Editor,{},pinia)
    assert.equal(view.el.querySelector('textarea').value,'My manual edit');assert.match(view.el.querySelector('[role=alert]').textContent,/Ваши правки сохранены/)
    await click(button(view.el,'Взять актуальный'));assert.equal(view.el.querySelector('textarea').value,'Updated by agent');assert.equal(view.el.querySelector('[role=alert]'),null)
    await click(button(view.el,'Отмена'));view.close();view=await mount(Editor,{},pinia);assert.equal(view.el.querySelector('textarea').value,'Updated by agent')
    key.id='b';await nextTick();assert.equal(view.el.querySelector('textarea'),null)
  }finally{view.close()}
})
test('prefix cleanup and chat deletion clear only their owner and selection',async()=>{
  const {useDraftsStore,useChatDraftsStore}=await compiled;const pinia=createPinia();const store=useDraftsStore(pinia),chats=useChatDraftsStore(pinia)
  for(const key of ['task:a:plan-edit','task:a:section:1','task:ab:plan-edit','session:one','session:one:reply','session:two'])store.get(key,()=>({text:key}))
  store.clearPrefix('task:a:');assert.equal(store.drafts['task:a:plan-edit'],undefined);assert.ok(store.drafts['task:ab:plan-edit'])
  chats.selectedByProject.p='one';chats.selectedByProject.other='two';chats.removeSession('one');assert.equal(store.drafts['session:one'],undefined);assert.equal(store.drafts['session:one:reply'],undefined);assert.ok(store.drafts['session:two']);assert.equal(chats.selectedByProject.p,undefined);assert.equal(chats.selectedByProject.other,'two')
})


test('successful task deletion clears drafts; a rejected deletion keeps them', async () => {
  const {useDraftsStore,useWorkActions,testApi}=await compiled
  let actions; const view=await mount({setup(){ actions=useWorkActions();return()=>null }},{})
  try {
    const store=useDraftsStore(view.pinia);store.get('task:deleted:plan-edit',()=>({text:'mine'}));store.get('task:other:plan-edit',()=>({text:'keep'}))
    const task={id:'deleted',project_id:'p',kind:'task',key:'T'}
    testApi.delete=async()=>{throw new Error('failed')};assert.equal(await actions.remove(task),false);assert.ok(store.drafts['task:deleted:plan-edit'])
    testApi.delete=async()=>undefined;assert.equal(await actions.remove(task),true);assert.equal(store.drafts['task:deleted:plan-edit'],undefined);assert.ok(store.drafts['task:other:plan-edit'])
  }finally{view.close()}
})
test('material and analysis editors restore edits and detect updates made while away',async()=>{
  const {MaterialPanel,AnalysisSectionCard}=await compiled
  for(const [Component,props,editLabel,update] of [
    [MaterialPanel,reactive({projectId:'p',taskId:'t',type:'qa',material:{content:'Original',version:1},done:false,lockedReason:'',chats:[],selectedChat:null,initials:{},launching:false,launchError:'',live:false}),'Редактировать вручную',p=>{p.material={content:'Agent update',version:2}}],
    [AnalysisSectionCard,reactive({section:{id:'s',task_id:'t',title:'Section',description:'Original',kind:'source',author:'developer',files:[]},locked:false,highlight:false,opened:false,agentRevision:0}),'Редактировать раздел',p=>{p.section={...p.section,description:'Agent update'}}]
  ]){
    let view=await mount(Component,props)
    try{
      const edit=view.el.querySelector('[aria-label="'+editLabel+'"]')??button(view.el,editLabel);await click(edit)
      await type(view.el.querySelector('textarea'),'My manual text');const pinia=view.pinia;view.close();update(props);view=await mount(Component,props,pinia)
      assert.equal(view.el.querySelector('textarea').value,'My manual text');assert.ok(view.el.querySelector('[role=alert]'))
      await click(button(view.el,'Взять актуальный'));assert.equal(view.el.querySelector('textarea').value,'Agent update')
      await click(button(view.el,'Отмена'));view.close();view=await mount(Component,props,pinia);assert.equal(view.el.querySelector('textarea'),null)
    }finally{view.close()}
  }
})
