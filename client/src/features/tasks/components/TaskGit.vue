<template>
  <section class="task-git">
    <div class="tg-head">
      <span class="section-label">Ветка задачи</span>
      <span v-if="task.branch_name" class="muted" title="Рабочая ветка задачи">⎇ {{ task.branch_name }}</span>
      <span class="tg-spacer" />
      <span v-if="saved" class="tg-saved" role="status">Сохранено</span>
    </div>
    <div class="tg-grid">
      <label><span>Ключ внешней задачи</span><input v-model="external" class="control control-sm" placeholder="PROJ-123" :disabled="busy" @change="save" /></label>
      <label><span>Ссылка на внешнюю задачу</span>
        <span class="tg-inline"><input v-model="url" class="control control-sm" placeholder="https://…" :disabled="busy" @change="save" /><a v-if="safeUrl" :href="safeUrl" target="_blank" rel="noopener noreferrer" class="btn btn-subtle btn-sm" title="Открыть внешнюю задачу">↗</a></span>
      </label>
      <label><span>Базовая ветка</span><input v-model="base" class="control control-sm" :list="branchList" placeholder="main" :disabled="busy" @change="save" /></label>
      <label><span>Имя рабочей ветки</span><BranchNameInput v-model="name" :prefixes="prefixes" :disabled="busy" @enter.prevent="create" /></label>
    </div>
    <datalist :id="branchList"><option v-for="b in branches" :key="b.ref" :value="b.name" /></datalist>
    <div class="tg-actions">
      <span class="tg-hint">Plangent сделает fetch и создаст ветку от свежей базы из origin.</span>
      <button type="button" class="btn btn-ghost btn-sm" :disabled="busy || !base || !name" @click="create">{{ busy && creating ? 'Создание…' : 'Создать ветку' }}</button>
    </div>
    <p v-if="error" role="alert" class="tg-error">{{ error }}</p>
  </section>
</template>
<script setup lang="ts">
import { ref, computed, watch, onScopeDispose } from 'vue'
import { api } from '@core/api'
import { useAppStore } from '@core/stores/app'
import { gitApi, type GitBranch } from '@features/code'
import { errorText } from '@shared/utils/errorText'
import BranchNameInput from '@shared/ui/BranchNameInput.vue'
import type { Task, ProjectGitSettings } from '@core/models'
const props=defineProps<{ projectId: string; task: Task }>()
const app=useAppStore(), external=ref(''), url=ref(''), base=ref(''), name=ref(''), busy=ref(false), creating=ref(false), error=ref(''), saved=ref(false), branches=ref<GitBranch[]>([])
const branchList=computed(()=>'task-base-'+props.task.id)
const safeUrl=computed(()=>{try{const u=new URL(url.value.trim());return ['http:','https:'].includes(u.protocol)?u.href:undefined}catch{return undefined}})
const root=()=>'/projects/'+encodeURIComponent(props.projectId)+'/tasks/'+encodeURIComponent(props.task.id)
const prefixes=ref<string[]>([])
let generation=0, savedTimer: ReturnType<typeof setTimeout> | undefined
onScopeDispose(()=>clearTimeout(savedTimer))
function suggested(){const slug=(props.task.title||props.task.key).toLowerCase().replace(/[^a-z0-9а-яё]+/gi,'-').replace(/^-|-$/g,'');return (prefixes.value[0]?prefixes.value[0]+'/':'')+(external.value||props.task.key)+'-'+slug}
function flashSaved(){saved.value=true;clearTimeout(savedTimer);savedTimer=setTimeout(()=>{saved.value=false},2000)}
watch(()=>props.task.id,async()=>{const mine=++generation;external.value=props.task.external_key||'';url.value=props.task.jira_url||'';base.value=props.task.base_branch||'';name.value=props.task.branch_name||'';error.value='';try{const [prefs,bs]=await Promise.all([api.get<{values:ProjectGitSettings}>('/projects/'+encodeURIComponent(props.projectId)+'/git-settings'),gitApi.branches(props.projectId)]);if(mine!==generation)return;branches.value=bs;prefixes.value=prefs.values.branch_prefixes??[];base.value ||= prefs.values.base_branch||'';name.value ||= suggested()}catch(e){error.value=errorText(e)}},{immediate:true})
async function save(){busy.value=true;error.value='';try{await api.patch(root(),{external_key:external.value.trim()||null,jira_url:url.value.trim()||null,base_branch:base.value.trim()||null});if(!props.task.branch_name)name.value=suggested();flashSaved()}catch(e){error.value=errorText(e)}finally{busy.value=false}}
async function create(){if(busy.value||!base.value||!name.value)return;busy.value=true;creating.value=true;error.value='';try{await api.post(root()+'/branch',{name:name.value,base:base.value});app.toast('Ветка '+name.value+' создана','success')}catch(e){const text=errorText(e);if(text.includes('незакоммиченные'))await app.confirm(text,{confirmLabel:'Понятно'});else error.value=text}finally{busy.value=false;creating.value=false}}
</script>
<style scoped>
.task-git{display:flex;flex-direction:column;gap:10px;padding:12px;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg2)}
.tg-head{display:flex;align-items:center;gap:8px;min-height:var(--size-xs)}
.section-label{font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px}
.tg-spacer{flex:1}
.tg-saved{font-size:11px;color:var(--accent-hover)}
.tg-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px}
label{display:flex;flex-direction:column;gap:4px;font-size:12px;color:var(--text-muted);min-width:0}
.control{width:100%}
.tg-inline{display:flex;gap:4px}.tg-inline .control{flex:1;min-width:0}.tg-inline .btn{text-decoration:none}
.tg-actions{display:flex;align-items:center;gap:8px}
.tg-hint{flex:1;font-size:11.5px;color:var(--text-faint)}
.tg-error{font-size:12px;padding:6px 10px;border-radius:var(--radius-sm);color:var(--danger-hover);background:var(--danger-soft);overflow-wrap:anywhere}
</style>
