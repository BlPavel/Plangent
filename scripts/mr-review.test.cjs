
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
const { parse, compileScript, compileTemplate } = require('@vue/compiler-sfc');

async function component(file) {
  const bundle = await build({
    entryPoints: [path.resolve(file)], bundle: true, write: false, platform: 'node', format: 'cjs',
    external: ['vue', 'pinia'],
    loader: { '.md': 'text', '.css': 'empty' }, // Match Vite's bundled Markdown ?raw imports.
    alias: { '@core': path.resolve('client/src/core'), '@shared': path.resolve('client/src/shared') },
    plugins: [{ name: 'vue-test', setup(build) { build.onLoad({ filter: /\.vue$/ }, args => {
      const { descriptor } = parse(fs.readFileSync(args.path, 'utf8'), { filename: args.path });
      // Template-only components (icons) have no script to compile.
      if (!descriptor.script && !descriptor.scriptSetup) return { contents: compileTemplate({ source: descriptor.template.content, filename: args.path, id: args.path }).code + '\nexport default { render };', loader: 'js', resolveDir: path.dirname(args.path) };
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


Object.defineProperty(window.HTMLElement.prototype,'clientHeight',{configurable:true,get(){return 600}})
Object.defineProperty(window.HTMLElement.prototype,'scrollTop',{configurable:true,writable:true,value:0})
global.ResizeObserver=class { observe(){} unobserve(){} disconnect(){} }
window.HTMLElement.prototype.getBoundingClientRect=function(){return {height:96,width:800,top:0,left:0,bottom:96,right:800}}
test('review tab selects a diff line, saves and edits a local draft, then confirms publication',async()=>{
  const calls=[]
  const refs={base_sha:'base',start_sha:'start',head_sha:'head'},user={id:1,name:'Reviewer',username:'reviewer'}
  const snapshot={
    mr:{iid:7,title:'Feature',author:user,source_branch:'feature',target_branch:'main',sha:'head',web_url:'https://host/team/repo/-/merge_requests/7'},
    version:{id:1,base_commit_sha:'base',start_commit_sha:'start',head_commit_sha:'head',created_at:'now'},
    versions:[{id:1,created_at:'now'}],capabilities:{approve:true,batchReview:false},
    files:[{old_path:'file.ts',new_path:'file.ts',diff:'@@ -1,3 +1,3 @@\n context\n-removed\n+added\n context2\n',new_file:false,deleted_file:false,renamed_file:false}],
    discussions:[{id:'removed-thread',notes:[{id:10,body:'Existing remark on removed line',author:user,position:{...refs,old_path:'file.ts',new_path:'file.ts',old_line:2,new_line:null}}]}]
  }
  const detail={session:{id:'r',project_id:'p',snapshot,previous:null},drafts:[],viewed:[],changed_files:[]}
  const prefix='/api/projects/p/mr-review'
  global.fetch=async(url,options)=>{
    const data=options.body ? JSON.parse(options.body) : undefined
    calls.push({url,method:options.method,data});let response={}
    if(url===prefix || url.startsWith(prefix+'?'))response={requests:[{project_id:'p',project_name:'Repo',mr:snapshot.mr,has_updates:false}],errors:[]}
    else if(url===prefix+'/open' || url===prefix+'/r')response=detail
    else if(url.startsWith(prefix+'/r/file?path=file.ts'))response={content:'context\nadded\ncontext2\n'}
    else if(url===prefix+'/r/drafts'){
      assert.equal(data.side,'new');assert.equal(data.line,2)
      response={id:'d',review_id:'r',body:data.body,status:'draft',remote_id:null,error:'',position:{...refs,position_type:'text',old_path:'file.ts',new_path:'file.ts',new_line:2}}
      detail.drafts.push(response)
    }else if(url===prefix+'/r/drafts/d' && options.method==='PATCH'){detail.drafts[0].body=data.body;response=detail}
    else if(url===prefix+'/r/publish'){
      assert.equal(data.confirmed,true);assert.deepEqual(data.ids,['d']);detail.drafts[0].status='sent'
      snapshot.discussions.push({id:'discussion',notes:[{id:1,body:detail.drafts[0].body,author:user,position:detail.drafts[0].position}]})
      response=detail
    }else throw Error('Unexpected request '+url)
    return new Response(JSON.stringify(response),{status:200,headers:{'Content-Type':'application/json'}})
  }
  const Review=await component('client/src/features/mr-review/views/ReviewTab.vue')
  const pinia=createPinia(),app=createApp(Review,{projectId:'p'}).use(pinia)
  app.mount('#app');await flush()
  const request=document.querySelector('.request');assert.ok(request);request.click();await flush();await flush()
  assert.match(document.body.textContent,/Existing remark on removed line/)
  const gutter=document.querySelector('[data-line="2"][data-side="new"] .cv-gutter');assert.ok(gutter,document.body.innerHTML)
  gutter.dispatchEvent(new window.Event('mousedown',{bubbles:true}));window.dispatchEvent(new window.Event('mouseup'));await flush()
  const note=document.querySelector('[aria-label="Ваше замечание"]');assert.ok(note)
  note.value='Written by reviewer';note.dispatchEvent(new window.Event('input',{bubbles:true}));await flush()
  await click('В черновик');assert.equal(calls.filter(c=>c.url.endsWith('/publish')).length,0)
  const draft=document.querySelector('[aria-label="Текст черновика"]');assert.equal(draft.value,'Written by reviewer')
  draft.value='Manually edited';draft.dispatchEvent(new window.Event('input',{bubbles:true}));await flush()
  assert.equal(button('Опубликовать ревью').disabled,true)
  await click('Сохранить правку');assert.equal(detail.drafts[0].body,'Manually edited')
  await click('Опубликовать ревью')
  assert.ok(pinia._s.get('app').confirmState);assert.equal(calls.filter(c=>c.url.endsWith('/publish')).length,0)
  pinia._s.get('app').resolveConfirm(true);await flush();await flush()
  assert.equal(calls.filter(c=>c.url.endsWith('/publish')).length,1);assert.match(document.body.textContent,/Manually edited/)
  const count=calls.length;await flush();assert.equal(calls.length,count,'no polling');app.unmount()
})
test('GitLab preset keeps the PAT out of configuration and exposes a prefilled browser link',async()=>{
  const calls=[],preset={id:'gitlab-token',code_host:'gitlab',name:'GitLab (токен)',description:'PAT',auth_strategy:'token',auth_config:{check_path:'/api/v4/user',user_path:'name',expect_json:true,token_header:'PRIVATE-TOKEN',token_prefix:''}}
  global.fetch=async(url,options)=>{
    const body=options.body ? JSON.parse(options.body) : undefined;calls.push({url,body,method:options.method})
    let response={}
    if(url==='/api/integrations/normalize-url')response={base_url:'https://host'}
    if(url==='/api/integrations/connections')response={id:'c'}
    return new Response(JSON.stringify(response),{status:200,headers:{'Content-Type':'application/json'}})
  }
  const Form=await component('client/src/features/settings/components/ConnectionFormModal.vue')
  const app=createApp(Form,{modelValue:true,connection:null,organizations:[],credentials:[],presets:[preset]}).use(createPinia())
  app.mount('#app');await flush();await click('GitLab (токен)');await field('Адрес сервиса','https://host')
  assert.equal(document.querySelector('a[target="_blank"]').getAttribute('href'),'https://host/-/user_settings/personal_access_tokens?name=Plangent&scopes=api')
  await field('Токен','private-pat')
  assert.equal([...document.querySelectorAll('.form-field label')].some(l=>l.textContent==='Собственный логин'),false)
  await click('Сохранить')
  const config=calls.find(c=>c.url==='/api/integrations/connections').body
  assert.equal(config.code_host,'gitlab');assert.equal(config.auth_strategy,'token');assert.equal(config.own_credential.username,'token');assert.ok(!JSON.stringify(config).includes('private-pat'))
  assert.equal(calls.find(c=>c.url.endsWith('/password')).body.password,'private-pat');app.unmount()
})
