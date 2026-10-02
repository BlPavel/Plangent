<template>
  <div class="analysis-tab" :class="{ readonly: done }">
    <header class="analysis-bar">
      <span class="section-label">Документ анализа</span>
      <span v-if="sections.length" class="analysis-meta">
        исходных: {{ sections.filter(s => s.kind === 'source').length }} · проработанных: {{ sections.filter(s => s.kind === 'worked').length }}
      </span>
      <div class="analysis-actions">
        <!-- CSS-only toggle: the chat stays mounted, it is just hidden while the feed needs the room -->
        <label v-if="!done" class="btn btn-subtle btn-sm chat-toggle" title="Показать или скрыть чат анализа">
          <input type="checkbox" class="chat-toggle-input">
          <span class="when-shown">Скрыть чат</span>
          <span class="when-hidden">Показать чат</span>
        </label>
        <AppButton v-if="!done && sections.length" variant="primary" size="sm" title="Открыть «План» и начать планирование по анализу" @click="$emit('planning')">Перейти к планированию →</AppButton>
      </div>
    </header>

    <div class="analysis-split">
      <section class="feed">
        <div v-if="lockedReason" class="banner" :class="done ? 'subtle' : 'warn'">
          <svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="3.5" y="7" width="9" height="6.5" rx="1.3" stroke="currentColor" stroke-width="1.3" /><path d="M5.5 7V5.2a2.5 2.5 0 015 0V7" stroke="currentColor" stroke-width="1.3" /></svg>
          <span>{{ lockedReason }}{{ done ? '' : '. Правка откроется, когда агенты закончат или будут ждать вашего ответа.' }}</span>
        </div>
        <div v-if="error" class="banner danger" role="alert">{{ error }}</div>

        <div v-if="!sections.length" class="analysis-empty">
          <template v-if="done">По задаче не было анализа.</template>
          <template v-else>
            <div class="empty-title">Анализ необязателен</div>
            <p>Соберите исходные материалы — ТЗ, API, макеты, переписку — и обсудите их с агентом в чате. Выводы он сохранит проработанными разделами.</p>
            <p>Для небольшой задачи можно сразу перейти к плану.</p>
            <AppButton variant="primary" size="sm" @click="$emit('planning')">Перейти к планированию →</AppButton>
          </template>
        </div>

        <template v-for="kind in kinds" :key="kind">
          <AnalysisSectionGroup
            :kind="kind" :sections="sections.filter(s => s.kind === kind)" :locked="!!lockedReason" :highlights="highlights" :opened="opened" :agent-revision="agentRevision"
            @add="adding = $event; newTitle = ''; newDescription = ''" @save="save" @remove="remove" @move="move" @reorder="reorder" @shift="shift" @upload="upload" @file="viewFile" @delete-file="deleteFile"
          />
          <form v-if="adding === kind && !lockedReason" class="new-section" @submit.prevent="newTitle.trim() && create()">
            <div class="new-section-head">Новый {{ kind === 'source' ? 'исходный' : 'проработанный' }} раздел</div>
            <input v-model="newTitle" class="control" placeholder="Заголовок" aria-label="Заголовок нового раздела">
            <textarea v-model="newDescription" class="control editor" rows="5" placeholder="Описание в markdown" aria-label="Описание нового раздела" />
            <div class="new-section-foot">
              <span class="hint">Файлы можно приложить сразу после создания.</span>
              <AppButton variant="ghost" size="sm" type="button" @click="adding = null">Отмена</AppButton>
              <AppButton variant="primary" size="sm" type="submit" :disabled="!newTitle.trim()">Создать</AppButton>
            </div>
          </form>
        </template>
      </section>

      <AnalysisChats v-if="!done" class="analysis-chat-pane" :project-id="projectId" :default-agent-id="defaultAgentId" :chats="chats" :selected="selectedChat" :initials="initials" :busy="launching" :error="launchError" @select="$emit('selectChat', $event)" @launch="$emit('launch', $event)" />
    </div>

    <Teleport to="body">
      <div v-if="viewing" class="file-overlay" @click.self="viewing = null">
        <AnalysisFileView class="file-dialog" :file="viewing.file" :url="fileUrl(viewing.section, viewing.file)" @close="viewing = null" />
      </div>
    </Teleport>
  </div>
</template>
<script setup lang="ts">
import { ref, watch } from 'vue'
import { api } from '@core/api'
import { useAppStore } from '@core/stores/app'
import type { AnalysisSection, AnalysisFile } from '@core/models'
import type { NewChatRequest, ContentBlock } from '@features/agent-chat'
import type { AnalysisChatSnapshot } from '../stores/taskSession'
import AppButton from '@shared/ui/AppButton.vue'
import AnalysisSectionGroup from './AnalysisSectionGroup.vue'
import AnalysisFileView from './AnalysisFileView.vue'
import AnalysisChats from './AnalysisChats.vue'
const props = defineProps<{ projectId: string; taskId: string; defaultAgentId?: string | null; sections: AnalysisSection[]; done: boolean; lockedReason: string; highlights: string[]; opened: string | null; openFile?: string; agentRevision: number; chats: AnalysisChatSnapshot[]; selectedChat: string | null; initials: Record<string, ContentBlock[]>; launching: boolean; launchError: string }>()
const emit = defineEmits<{ reload: []; planning: []; selectChat: [id: string | null]; launch: [request: NewChatRequest] }>()
const app = useAppStore()
const kinds = ['source', 'worked'] as const
const error = ref(''), adding = ref<AnalysisSection['kind'] | null>(null), newTitle = ref(''), newDescription = ref('')
const viewing = ref<{ section: AnalysisSection; file: AnalysisFile } | null>(null)
const base = () => `/projects/${props.projectId}/tasks/${props.taskId}/analysis`
async function action(job: () => Promise<unknown>) {
  if (props.lockedReason) return false
  error.value = ''
  try { await job(); emit('reload'); return true } catch (e) { error.value = String(e); return false }
}
async function create() { await action(async () => { await api.post(base(), { title: newTitle.value, description: newDescription.value, kind: adding.value }); adding.value = null }) }
async function save(section: AnalysisSection, data: { title: string; description: string }, finish: (saved: boolean) => void) { finish(await action(() => api.patch(base() + '/' + section.id, data))) }
function move(section: AnalysisSection, kind: AnalysisSection['kind']) { return action(() => api.patch(base() + '/' + section.id, { kind })) }
async function remove(section: AnalysisSection) {
  if (await app.confirm('Удалить раздел «' + section.title + '» и его файлы?')) await deleteWithWarning(base() + '/' + section.id)
}
async function deleteWithWarning(path: string) {
  await action(async () => {
    const response = await fetch('/api' + path, { method: 'DELETE' })
    if (response.ok) return
    const data = await response.json()
    if (data.confirmation_required) {
      const steps = data.references.map((s: { id?: string; text: string }) => (s.id ?? '') + ' ' + s.text).join('\n')
      if (await app.confirm('На материал ссылаются шаги плана:\n' + steps + '\nУдалить?')) await api.delete(path + '?confirm=true')
    } else throw new Error(data.error)
  })
}
async function deleteFile(section: AnalysisSection, file: AnalysisFile) {
  if (await app.confirm('Удалить файл «' + file.name + '»?')) await deleteWithWarning(base() + '/' + section.id + '/files/' + file.id)
}
function shift(section: AnalysisSection, direction: number) {
  const group = props.sections.filter(s => s.kind === section.kind)
  const neighbor = group[group.findIndex(s => s.id === section.id) + direction]
  if (!neighbor) return
  const ids = props.sections.map(s => s.id)
  const from = ids.indexOf(section.id), to = ids.indexOf(neighbor.id)
  ;[ids[from], ids[to]] = [ids[to], ids[from]]
  return action(() => api.post(base() + '/reorder', { ids }))
}
function reorder(id: string, before: string) {
  const ids = props.sections.map(s => s.id).filter(x => x !== id)
  if (!props.sections.some(s => s.id === id) || id === before) return
  ids.splice(ids.indexOf(before), 0, id)
  return action(() => api.post(base() + '/reorder', { ids }))
}
async function upload(section: AnalysisSection, files: File[]) {
  await action(async () => {
    for (const file of files) {
      if (file.size > 25 * 1024 * 1024) throw new Error('Файл превышает 25 МБ: ' + file.name)
      const data = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsDataURL(file) })
      await api.post(base() + '/' + section.id + '/files', { name: file.name, mime: file.type || undefined, data })
    }
  })
}
function fileUrl(section: AnalysisSection, file: AnalysisFile) { return '/api' + base() + '/' + section.id + '/files/' + file.id }
function viewFile(section: AnalysisSection, file: AnalysisFile) { viewing.value = { section, file } }
watch([() => props.opened, () => props.openFile, () => props.sections], () => {
  const section = props.sections.find(s => s.id === props.opened)
  const file = section?.files.find(f => f.name === props.openFile)
  if (section && file) viewing.value = { section, file }
  else if (props.opened) viewing.value = null
})
</script>
<style scoped>
.analysis-tab { flex: 1; min-height: 0; display: flex; flex-direction: column; overflow: hidden; }

.analysis-bar { display: flex; align-items: center; gap: 12px; padding: 8px 20px; min-height: 45px; border-bottom: 1px solid var(--border); background: var(--bg); flex-shrink: 0; flex-wrap: wrap; }
.section-label { font-size: 11px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px; }
.analysis-meta { font-size: 12px; color: var(--text-faint); }
.analysis-actions { margin-left: auto; display: flex; align-items: center; gap: 8px; }

.chat-toggle { position: relative; }
.chat-toggle-input { position: absolute; opacity: 0; width: 0; height: 0; pointer-events: none; }
.chat-toggle:has(.chat-toggle-input:focus-visible) { outline: 2px solid var(--blue); outline-offset: 1px; }
.chat-toggle .when-hidden { display: none; }
.chat-toggle:has(.chat-toggle-input:checked) .when-shown { display: none; }
.chat-toggle:has(.chat-toggle-input:checked) .when-hidden { display: inline; }

/* Feed on the left, chat on the right; the feed takes the whole width when the chat is hidden or the task is done */
.analysis-split { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(380px, 1fr) minmax(340px, 44%); }
.analysis-tab:has(.chat-toggle-input:checked) .analysis-split,
.analysis-tab.readonly .analysis-split { grid-template-columns: minmax(0, 1fr); }
.analysis-tab:has(.chat-toggle-input:checked) .analysis-chat-pane { display: none; }

.feed { min-height: 0; min-width: 0; overflow-y: auto; padding: 16px 20px 32px; display: flex; flex-direction: column; gap: 20px; border-right: 1px solid var(--border); }
.analysis-tab:has(.chat-toggle-input:checked) .feed,
.readonly .feed { border-right: none; padding-left: max(20px, calc((100% - 880px) / 2)); padding-right: max(20px, calc((100% - 880px) / 2)); }
.analysis-chat-pane { min-height: 0; min-width: 0; }

.banner { display: flex; align-items: flex-start; gap: 8px; font-size: 12px; line-height: 1.45; padding: 8px 12px; border-radius: var(--radius-sm); border: 1px solid var(--border); background: var(--bg2); color: var(--text-muted); }
.banner svg { width: 14px; height: 14px; flex-shrink: 0; margin-top: 1px; }
.banner.warn { border-color: var(--warning); background: var(--warning-soft); color: var(--warning-text); }
.banner.subtle { border-style: dashed; }
.banner.danger { border-color: var(--danger); background: var(--danger-soft); color: var(--danger-hover); }

.analysis-empty { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 28px 24px; border: 1px dashed var(--border-strong); border-radius: var(--radius); text-align: center; font-size: 12.5px; line-height: 1.5; color: var(--text-muted); }
.analysis-empty p { max-width: 460px; }
.analysis-empty .btn { margin-top: 6px; }
.empty-title { font-size: 14px; font-weight: 600; color: var(--text); }

/* The group's own "+ Добавить" hides while its new-section form is open */
.feed :deep(.analysis-group:has(+ .new-section) .group-add) { display: none; }
.new-section { display: flex; flex-direction: column; gap: 8px; margin-top: -10px; padding: 12px; border: 1px solid var(--blue); border-radius: var(--radius); background: var(--bg2); box-shadow: 0 0 0 3px var(--blue-soft); }
.new-section-head { font-size: 12px; font-weight: 600; color: var(--text-muted); }
.new-section .control { width: 100%; }
.new-section .editor { height: auto; min-height: 96px; padding: 8px 12px; line-height: 1.5; resize: vertical; font-family: 'Cascadia Code', 'JetBrains Mono', monospace; font-size: 12.5px; }
.new-section-foot { display: flex; align-items: center; gap: 8px; }
.new-section-foot .hint { flex: 1; font-size: 11.5px; color: var(--text-faint); }

.file-overlay { position: fixed; inset: 0; z-index: 100; display: flex; align-items: center; justify-content: center; padding: 32px; background: rgba(1, 4, 9, 0.72); backdrop-filter: blur(2px); }
.file-dialog { width: min(960px, 100%); max-height: 100%; }
</style>
