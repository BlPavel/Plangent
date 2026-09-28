<template>
  <div class="terminals">
    <aside>
      <div v-for="terminal in terminals" :key="terminal.id" class="item" :class="{ active: selected === terminal.id }" @click="selected = terminal.id" @dblclick="renameId = terminal.id; title = terminal.title" @contextmenu.prevent="menuId = terminal.id">
        {{ terminal.exitCode === undefined ? '●' : '◌' }} {{ terminal.title }} <small v-if="terminal.exitCode !== undefined">exit {{ terminal.exitCode }}</small>
        <div v-if="menuId === terminal.id" class="menu">
          <button class="btn" @click.stop="renameId = terminal.id; title = terminal.title; menuId = ''">Переименовать</button>
          <button class="btn" @click.stop="action(terminal.id, 'restart')">Перезапустить</button>
          <button class="btn" @click.stop="action(terminal.id, 'clear')">Очистить</button>
          <button class="btn" @click.stop="close(terminal.id)">Закрыть</button>
        </div>
      </div>
      <select v-model="shell"><option v-for="s in shells" :key="s.id" :value="s.id">{{ s.name }}</option></select>
      <button class="btn btn-primary" @click="create">+ Новый терминал</button>
      <p v-if="error">{{ error }}</p>
    </aside>
    <main><TerminalPane v-if="selected" :key="selected + generation" :session-id="selected" :show-header="false" :visible="visible" /><div v-else class="empty-state">Откройте терминал в папке проекта</div></main>
    <AppModal :model-value="!!renameId" title="Название терминала" @update:model-value="renameId = ''" @confirm="rename"><FormField v-model="title" label="Название" /></AppModal>
  </div>
</template>
<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { api } from '@core/api'
import AppModal from '@shared/ui/AppModal.vue'
import FormField from '@shared/ui/FormField.vue'
import TerminalPane from './TerminalPane.vue'
const props = defineProps<{ projectId: string; visible: boolean }>()
const terminals = ref<{ id: string; title: string; exitCode?: number }[]>([])
const shells = ref<{ id: string; name: string }[]>([])
const selected = ref(''), shell = ref(''), error = ref(''), menuId = ref(''), renameId = ref(''), title = ref(''), generation = ref(0)
let timer: ReturnType<typeof setInterval>
async function load() { try { const id = props.projectId; const rows = await api.get<typeof terminals.value>(`/terminals?projectId=${id}`); if (props.projectId !== id) return; terminals.value = rows; if (!rows.some(t => t.id === selected.value)) selected.value = rows[0]?.id ?? '' } catch (e) { error.value = String(e) } }
watch(() => props.projectId, () => { selected.value = ''; void load() }, { immediate: true })
async function create() { try { const t = await api.post<{ id: string }>('/terminals', { projectId: props.projectId, shell: shell.value }); await load(); selected.value = t.id } catch (e) { error.value = String(e) } }
async function action(id: string, name: string) { try { await api.post(`/terminals/${id}/${name}`); generation.value++; menuId.value = ''; await load() } catch (e) { error.value = String(e) } }
async function close(id: string) { await api.delete(`/terminals/${id}`); await load() }
async function rename() { await api.patch(`/terminals/${renameId.value}`, { title: title.value }); renameId.value = ''; await load() }
function shortcut(e: KeyboardEvent) { if (props.visible && e.ctrlKey && e.shiftKey && e.code === 'Backquote') { e.preventDefault(); void create() } }
onMounted(async () => { shells.value = await api.get('/terminals/shells'); shell.value = shells.value[0]?.id ?? ''; timer = setInterval(load, 3000); window.addEventListener('keydown', shortcut) })
onBeforeUnmount(() => { clearInterval(timer); window.removeEventListener('keydown', shortcut) })
</script>
<style scoped>
.terminals{display:flex;height:100%;min-height:0}aside{width:230px;display:flex;flex-direction:column;gap:8px;padding:12px;overflow:auto;border-right:1px solid var(--border)}main{flex:1;min-width:0}.item{padding:10px;cursor:pointer;background:var(--bg2);border:1px solid var(--border)}.active{border-color:var(--blue)}select{background:var(--bg2);color:var(--text);padding:8px}.menu{display:flex;flex-direction:column}
</style>
