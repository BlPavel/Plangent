<template>
  <section class="task-mr" :aria-busy="busy">
    <div class="tm-bar">
      <template v-if="mr">
        <span class="tm-label">МР</span>
        <a v-if="safeUrl" class="tm-link" :href="safeUrl" target="_blank" rel="noopener noreferrer" title="Открыть в GitLab">!{{ mr.iid }} ↗</a>
        <span v-else class="tm-link">!{{ mr.iid }}</span>
        <span class="status-badge" :class="badges[mr.state] ?? 'neutral'" role="status">{{ states[mr.state] || mr.state }}</span>
        <button v-if="taskId" type="button" class="btn btn-subtle btn-xs" :disabled="busy" title="Запросить состояние МР в GitLab" @click="refresh">Обновить статус МР</button>
      </template>
      <span v-else-if="taskId && !inline" class="muted">МР ещё не создан</span>
      <button v-if="!done && !draft" type="button" class="btn btn-ghost btn-sm" :disabled="busy" title="Превью МР: ветка будет отправлена в origin, если ещё не отправлена" @click="open">{{ busy && !mr ? 'Подготовка…' : 'Создать МР' }}</button>
    </div>
    <div v-if="error" role="alert" class="tm-error git-drawer">{{ error }} <button type="button" class="btn btn-subtle btn-xs" @click="error = ''">✕</button></div>
    <form v-if="draft" class="preview git-drawer" @submit.prevent="create" @keydown.esc.stop.prevent="cancel" @keydown.enter.ctrl.exact.prevent="create" @keydown.enter.meta.exact.prevent="create">
      <div class="tm-head">
        <h4>Новый МР</h4>
        <span class="muted"><code>{{ draft.source_branch }}</code> · <code>{{ draft.head.slice(0, 8) }}</code> → <code>{{ draft.target_branch || '?' }}</code></span>
      </div>
      <div class="tm-grid">
        <label><span>Целевая ветка</span><input v-model="draft.target_branch" class="control control-sm" :list="branchList" :disabled="busy" required /></label>
        <label class="wide"><span>Заголовок</span><input v-model="draft.title" class="control control-sm" :disabled="busy" maxlength="1000" required /></label>
      </div>
      <datalist :id="branchList"><option v-for="branch in branches" :key="branch.ref" :value="branch.name.replace(/^origin\//, '')" /></datalist>
      <p v-if="draft.target_branch === draft.source_branch" class="tm-warn">Целевая ветка совпадает с исходной.</p>
      <label>
        <span class="tm-row">Описание <span class="tm-spacer" /><button type="button" class="btn btn-subtle btn-xs" :disabled="busy" @click="describe">✨ {{ generating ? 'Агент пишет…' : 'Предложить описание' }}</button></span>
        <textarea v-model="draft.description" class="control" :disabled="busy" rows="8" maxlength="100000" :placeholder="generating ? 'Агент готовит черновик описания…' : ''" />
      </label>
      <div class="tm-grid">
        <label><span>Ревьюеры (числовые ID через запятую)</span><input v-model="reviewers" class="control control-sm" :disabled="busy" placeholder="12, 34" /></label>
        <label><span>Метки</span><input v-model="draft.labels" class="control control-sm" :disabled="busy" placeholder="backend, feature" /></label>
      </div>
      <div class="tm-flags">
        <label class="flag"><input v-model="draft.remove_source_branch" type="checkbox" :disabled="busy" />Удалить исходную ветку после merge</label>
        <label class="flag"><input v-model="draft.squash" type="checkbox" :disabled="busy" />Squash при merge</label>
      </div>
      <div class="tm-actions">
        <span class="tm-hint">Перед созданием Plangent отправит недостающие коммиты в origin. Ctrl+Enter — создать, Esc — закрыть.</span>
        <button type="button" class="btn btn-subtle btn-sm" :disabled="busy" @click="cancel">Закрыть превью</button>
        <button class="btn btn-blue btn-sm" :disabled="busy || !draft.title.trim() || !draft.target_branch.trim() || draft.target_branch === draft.source_branch">Подтвердить создание МР</button>
      </div>
    </form>
  </section>
</template>
<script setup lang="ts">
import { computed, ref, watch, onScopeDispose } from 'vue'
import { api } from '@core/api'
import { useAppStore } from '@core/stores/app'
import type { Task } from '@core/models'
import { errorText } from '@shared/utils/errorText'
import { taskMrApi } from '../api'
import type { MrPreview, TaskMr } from '../types'
/** inline: the panel sits in the «Код» git row, where a missing MR needs no words. */
const props=defineProps<{projectId:string;taskId?:string;inline?:boolean}>()
const app=useAppStore(), busy=ref(false), generating=ref(false), error=ref(''), draft=ref<MrPreview|null>(null), mr=ref<TaskMr|null>(null), reviewers=ref(''), done=ref(false)
const branches=ref<{name:string;ref:string}[]>([])
const branchList=computed(()=>'mr-target-'+props.projectId+'-'+(props.taskId||'project'))
const states:Record<string,string>={opened:'Открыт',merged:'Влит',closed:'Закрыт',locked:'Заблокирован'}
const badges:Record<string,string>={opened:'open',merged:'done',closed:'neutral',locked:'progress'}
const safeUrl=computed(()=>{try{const u=new URL(mr.value?.web_url||'');return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password?u.href:undefined}catch{return undefined}})
let generation=0
onScopeDispose(()=>{generation++})
async function refresh(){if(!props.taskId||busy.value)return;const mine=generation;busy.value=true;error.value='';try{const result=await taskMrApi.refresh(props.projectId,props.taskId);if(mine===generation)mr.value=result}catch(cause){if(mine===generation)error.value=errorText(cause)}finally{if(mine===generation)busy.value=false}}
watch(()=>[props.projectId,props.taskId],async()=>{
 const mine=++generation;draft.value=null;mr.value=null;error.value='';busy.value=false;done.value=false
 if(!props.taskId)return
 try{const task=await api.get<Task>('/projects/'+encodeURIComponent(props.projectId)+'/tasks/'+encodeURIComponent(props.taskId));if(mine!==generation)return;done.value=task.status==='done';if(task.mr_link){const link=JSON.parse(task.mr_link) as {iid:number;url:string;state:string};mr.value={iid:link.iid,web_url:link.url,state:link.state}}if(task.mr_link||task.branch_name)await refresh()}catch(cause){if(mine===generation)error.value=errorText(cause)}
},{immediate:true})
async function open(){if(busy.value)return;const mine=generation;busy.value=true;error.value='';try{const [value,bs]=await Promise.all([taskMrApi.preview(props.projectId,props.taskId),api.get<{name:string;ref:string}[]>('/projects/'+encodeURIComponent(props.projectId)+'/git/branches')]);if(mine!==generation)return;draft.value=value;reviewers.value=value.reviewer_ids.join(', ');branches.value=bs}catch(cause){if(mine===generation)error.value=errorText(cause)}finally{if(mine===generation)busy.value=false}
 if(mine===generation&&draft.value)await describe()
}
async function describe(){if(!draft.value||busy.value)return;const mine=generation,value={...draft.value};busy.value=true;generating.value=true;error.value='';try{const result=await taskMrApi.describe(props.projectId,value);if(mine===generation&&draft.value?.head===value.head&&draft.value.target_branch===value.target_branch)draft.value.description=result.description}catch(cause){if(mine===generation)error.value='Агент не подготовил описание: '+errorText(cause)+'. Текст можно написать вручную.'}finally{if(mine===generation){busy.value=false;generating.value=false}}}
async function create(){if(!draft.value||busy.value||!draft.value.title.trim()||!draft.value.target_branch.trim()||draft.value.target_branch===draft.value.source_branch)return;const mine=generation;error.value='';const ids=reviewers.value.trim()?reviewers.value.split(',').map(s=>Number(s.trim())):[];if(ids.some(id=>!Number.isSafeInteger(id)||id<1)){error.value='Укажите числовые ID ревьюеров через запятую';return}
 busy.value=true
 try{if(!await app.confirm('Создать МР «'+draft.value.title+'» из '+draft.value.source_branch+' в '+draft.value.target_branch+'? Необходимые коммиты будут отправлены в origin.',{confirmLabel:'Создать МР и push'}))return;if(mine!==generation||!draft.value)return;const result=await taskMrApi.create(props.projectId,{...draft.value,title:draft.value.title.trim(),target_branch:draft.value.target_branch.trim(),reviewer_ids:ids});if(mine===generation){mr.value=result;draft.value=null;app.toast(props.taskId?'МР создан и связан с задачей':'МР создан','success')}}catch(cause){if(mine===generation)error.value=errorText(cause)}finally{if(mine===generation)busy.value=false}
}
async function cancel(){if(busy.value&&!generating.value)return;if(!draft.value||await app.confirm('Закрыть превью МР? Несохранённый текст будет потерян.',{confirmLabel:'Закрыть'}))draft.value=null}
</script>
<style scoped>
.task-mr{flex-shrink:0;display:flex;flex-direction:column;gap:8px;padding:8px 20px;border-bottom:1px solid var(--border);max-height:65vh;overflow:auto}
.tm-bar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:12px}
.tm-label{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--text-muted)}
.tm-link{font-weight:600;color:var(--blue-hover);text-decoration:none;white-space:nowrap}
.tm-link:hover{text-decoration:underline}
.tm-error{display:flex;align-items:center;gap:8px;justify-content:space-between;padding:6px 10px;font-size:12px;border-radius:var(--radius-sm);color:var(--danger-hover);background:var(--danger-soft);overflow-wrap:anywhere}
.preview{display:flex;flex-direction:column;gap:10px;max-width:900px;padding:12px;border:1px solid var(--border-strong);border-radius:var(--radius);background:var(--bg2)}
.tm-head{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}
.tm-head h4{font-size:13px}
.tm-grid{display:grid;grid-template-columns:minmax(160px,1fr) minmax(0,2fr);gap:10px}
.tm-grid .wide{min-width:0}
label{display:flex;flex-direction:column;gap:4px;font-size:12px;color:var(--text-muted)}
.tm-row{display:flex;align-items:center;gap:8px}.tm-spacer{flex:1}
.control{width:100%;font-size:13px}
textarea.control{height:auto;padding:8px 10px;resize:vertical;line-height:1.5}
.tm-flags{display:flex;gap:16px;flex-wrap:wrap}
.flag{flex-direction:row;align-items:center;gap:6px;cursor:pointer}
.flag input{margin:0;accent-color:var(--blue)}
.tm-warn{font-size:12px;color:var(--warning-text)}
.tm-actions{display:flex;align-items:center;gap:8px;justify-content:flex-end}
.tm-hint{flex:1;font-size:11px;color:var(--text-faint)}
</style>
