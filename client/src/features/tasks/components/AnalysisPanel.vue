<template>
  <div ref="root" class="analysis-tab" :class="{ readonly: done, 'chat-hidden': chatHidden }">
    <header class="analysis-bar">
      <span class="section-label">Документ анализа</span>
      <span v-if="sections.length" class="analysis-meta">
        исходных: {{ sections.filter(s => s.kind === 'source').length }} · проработанных: {{ sections.filter(s => s.kind === 'worked').length }}
      </span>
      <div class="analysis-actions">
        <AppButton v-if="!done" variant="subtle" size="sm" :pressed="chatHidden" title="Показать или скрыть чат анализа" @click="chatHidden = !chatHidden">{{ chatHidden ? 'Показать чат' : 'Скрыть чат' }}</AppButton>
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
            <p>Для небольшой задачи можно сразу перейти дальше: «Пропустить этап» в меню кнопки перехода вверху отметит анализ пропущенным.</p>
          </template>
        </div>

        <template v-for="kind in kinds" :key="kind">
          <AnalysisSectionGroup
            :kind="kind" :sections="sections.filter(s => s.kind === kind)" :locked="!!lockedReason" :adding="adding === kind" :highlights="highlights" :opened="opened" :agent-revision="agentRevision"
            @add="adding = $event" @save="save" @remove="remove" @move="move" @reorder="reorder" @shift="shift" @upload="upload" @file="viewFile" @delete-file="deleteFile"
          />
          <form v-if="adding === kind && !lockedReason" class="new-section" @submit.prevent="newTitle.trim() && create()">
            <div class="new-section-head">Новый {{ kind === 'source' ? 'исходный' : 'проработанный' }} раздел</div>
            <AppInput v-model="newTitle"  placeholder="Заголовок" aria-label="Заголовок нового раздела" />
            <AppTextarea v-model="newDescription" block mono rows="5" placeholder="Описание в markdown" aria-label="Описание нового раздела" />
            <div class="new-section-foot">
              <span class="hint">Файлы можно приложить сразу после создания.</span>
              <AppButton variant="ghost" size="sm" type="button" @click="adding = null; newTitle = ''; newDescription = ''">Отмена</AppButton>
              <AppButton variant="primary" size="sm" type="submit" :disabled="!newTitle.trim()">Создать</AppButton>
            </div>
          </form>
        </template>
      </section>

      <TaskChats :workspace-id="workspaceId" v-if="!done" class="analysis-chat-pane" label="Анализ" :chats="chats" :selected="selectedChat" :initials="initials" @select="$emit('selectChat', $event)" @remove="(id, name) => $emit('removeChat', id, name)">
        <template #new>
          <NewChatPanel :draft-key="`task:${taskId}:analysis-chat`" :project-id="projectId" :workspace-id="workspaceId" :default-agent-id="defaultAgentId" title="Анализ задачи" text="Обсудите материалы. Агент сохранит результаты в разделы анализа." fixed-policy="read-only" :busy="launching" :error="launchError" @start="$emit('launch', $event)" />
        </template>
      </TaskChats>
    </div>

    <Teleport to="body">
      <div v-if="viewing" class="file-overlay" @click.self="viewing = null">
        <AnalysisFileView class="file-dialog" :file="viewing.file" :url="fileUrl(viewing.section, viewing.file)" @close="viewing = null" />
      </div>
    </Teleport>
  </div>
</template>
<script setup lang="ts">
import AppInput from '@shared/ui/AppInput.vue'
import AppTextarea from '@shared/ui/AppTextarea.vue'
import { useDraftsStore } from '@core/stores/drafts'
import { useDraft } from '@core/composables/useDraft'
import { ref, watch } from 'vue'
const chatHidden = ref(false)
const root = ref<HTMLElement>()
import { tasksEndpoints } from '../api'
import { useAppStore } from '@core/stores/app'
import type { AnalysisSection, AnalysisFile } from '@contracts'
import { NewChatPanel, useComposerReveal, type NewChatRequest, type ContentBlock } from '@features/agent-chat'
import AppButton from '@shared/ui/AppButton.vue'
import AnalysisSectionGroup from './AnalysisSectionGroup.vue'
import AnalysisFileView from './AnalysisFileView.vue'
import TaskChats from './TaskChats.vue'
const props = defineProps<{ projectId: string; workspaceId?: string | null; taskId: string; defaultAgentId?: string | null; sections: AnalysisSection[]; done: boolean; lockedReason: string; highlights: string[]; opened: string | null; openFile?: string; agentRevision: number; chats: { id: string; title: string }[]; selectedChat: string | null; initials: Record<string, ContentBlock[]>; launching: boolean; launchError: string }>()
// «В чат» with the chat folded away: unfold it; without a conversation it shows the new message field.
useComposerReveal(root, () => props, () => { if (!props.done) chatHidden.value = false })
const emit = defineEmits<{ reload: []; selectChat: [id: string | null]; removeChat: [id: string, name: string]; launch: [request: NewChatRequest] }>()
const app = useAppStore()
const kinds = ['source', 'worked'] as const
const error = ref(''), adding = useDraft<AnalysisSection['kind'] | null>(() => `task:${props.taskId}:section-new:kind`, () => null), newTitle = useDraft(() => `task:${props.taskId}:section-new:title`, () => ''), newDescription = useDraft(() => `task:${props.taskId}:section-new:description`, () => '')
const viewing = ref<{ section: AnalysisSection; file: AnalysisFile } | null>(null)
const params = () => ({ projectId: props.projectId, taskId: props.taskId })
const base = () => `/projects/${props.projectId}/tasks/${props.taskId}/analysis`
async function action(job: () => Promise<unknown>) {
  if (props.lockedReason) return false
  error.value = ''
  try { await job(); emit('reload'); return true } catch (e) { error.value = String(e); return false }
}
async function create() { await action(async () => { await tasksEndpoints.createAnalysis({ params: params(), body: { title: newTitle.value, description: newDescription.value, kind: adding.value ?? undefined } }); adding.value = null; newTitle.value = ''; newDescription.value = '' }) }
async function save(section: AnalysisSection, data: { title: string; description: string }, finish: (saved: boolean) => void) { finish(await action(() => tasksEndpoints.updateAnalysis({ params: { ...params(), sectionId: section.id }, body: data }))) }
function move(section: AnalysisSection, kind: AnalysisSection['kind']) { return action(() => tasksEndpoints.updateAnalysis({ params: { ...params(), sectionId: section.id }, body: { kind } })) }
async function remove(section: AnalysisSection) {
  if (await app.confirm('Удалить раздел «' + section.title + '» и его файлы?', { confirmLabel: 'Удалить', danger: true }) && await deleteWithWarning(section.id)) { useDraftsStore().clear(`task:${props.taskId}:section:${section.id}`) }
}
async function deleteWithWarning(sectionId: string, fileId?: string) {
  return action(async () => {
    const remove = (confirm?: string) => fileId
      ? tasksEndpoints.removeAnalysisFile({ params: { ...params(), sectionId, fileId }, query: { confirm } })
      : tasksEndpoints.removeAnalysis({ params: { ...params(), sectionId }, query: { confirm } })
    let data: import('@contracts').ApiError
    try { await remove(); return } catch (cause) { data = cause as Error & import('@contracts').ApiError }
    if (data.confirmation_required) {
      const steps = (data.references ?? []).map((s: { id?: string; text: string }) => (s.id ?? '') + ' ' + s.text).join('\n')
      if (!await app.confirm('На материал ссылаются шаги плана:\n' + steps + '\nУдалить?', { confirmLabel: 'Удалить', danger: true })) throw new Error('Удаление отменено')
      await remove('true')
    } else throw new Error(data.error)
  })
}
async function deleteFile(section: AnalysisSection, file: AnalysisFile) {
  if (await app.confirm('Удалить файл «' + file.name + '»?', { confirmLabel: 'Удалить', danger: true })) await deleteWithWarning(section.id, file.id)
}
function shift(section: AnalysisSection, direction: number) {
  const group = props.sections.filter(s => s.kind === section.kind)
  const neighbor = group[group.findIndex(s => s.id === section.id) + direction]
  if (!neighbor) return
  const ids = props.sections.map(s => s.id)
  const from = ids.indexOf(section.id), to = ids.indexOf(neighbor.id)
  ;[ids[from], ids[to]] = [ids[to], ids[from]]
  return action(() => tasksEndpoints.reorderAnalysis({ params: params(), body: { ids } }))
}
function reorder(id: string, target: string) {
  const after = props.sections.findIndex(s => s.id === id) < props.sections.findIndex(s => s.id === target)
  const ids = props.sections.map(s => s.id).filter(x => x !== id)
  if (!props.sections.some(s => s.id === id) || id === target || !ids.includes(target)) return
  ids.splice(ids.indexOf(target) + (after ? 1 : 0), 0, id)
  return action(() => tasksEndpoints.reorderAnalysis({ params: params(), body: { ids } }))
}
async function upload(section: AnalysisSection, files: File[]) {
  await action(async () => {
    for (const file of files) {
      if (file.size > 25 * 1024 * 1024) throw new Error('Файл превышает 25 МБ: ' + file.name)
      const data = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsDataURL(file) })
      await tasksEndpoints.uploadAnalysis({ params: { ...params(), sectionId: section.id }, body: { name: file.name, mime: file.type || undefined, data } })
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
.section-label { font-size: var(--fs-xs); font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px; }
.analysis-meta { font-size: var(--fs-sm); color: var(--text-faint); }
.analysis-actions { margin-left: auto; display: flex; align-items: center; gap: 8px; }


/* Feed on the left, chat on the right; the feed takes the whole width when the chat is hidden or the task is done */
.analysis-split { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(380px, 1fr) minmax(340px, 44%); }
.analysis-tab.chat-hidden .analysis-split,
.analysis-tab.readonly .analysis-split { grid-template-columns: minmax(0, 1fr); }
.analysis-tab.chat-hidden .analysis-chat-pane { display: none; }

.feed { min-height: 0; min-width: 0; overflow-y: auto; padding: 16px 20px 32px; display: flex; flex-direction: column; gap: 20px; border-right: 1px solid var(--border); }
.analysis-tab.chat-hidden .feed,
.readonly .feed { border-right: none; padding-left: max(20px, calc((100% - 880px) / 2)); padding-right: max(20px, calc((100% - 880px) / 2)); }
.analysis-chat-pane { min-height: 0; min-width: 0; }

.banner { display: flex; align-items: flex-start; gap: 8px; font-size: var(--fs-sm); line-height: 1.45; padding: 8px 12px; border-radius: var(--radius-sm); border: 1px solid var(--border); background: var(--bg2); color: var(--text-muted); }
.banner svg { width: 14px; height: 14px; flex-shrink: 0; margin-top: 1px; }
.banner.warn { border-color: var(--warning); background: var(--warning-soft); color: var(--warning-text); }
.banner.subtle { border-style: dashed; }
.banner.danger { border-color: var(--danger); background: var(--danger-soft); color: var(--danger-hover); }

.analysis-empty { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 28px 24px; border: 1px dashed var(--border-strong); border-radius: var(--radius); text-align: center; font-size: var(--fs-md); line-height: 1.5; color: var(--text-muted); }
.analysis-empty p { max-width: 460px; }
.analysis-empty .btn { margin-top: 6px; }
.empty-title { font-size: var(--fs-base); font-weight: 600; color: var(--text); }

/* The group's own "+ Добавить" hides while its new-section form is open */
.new-section { display: flex; flex-direction: column; gap: 8px; margin-top: -10px; padding: 12px; border: 1px solid var(--blue); border-radius: var(--radius); background: var(--bg2); box-shadow: 0 0 0 3px var(--blue-soft); }
.new-section-head { font-size: var(--fs-sm); font-weight: 600; color: var(--text-muted); }
.new-section .control { width: 100%; }
.new-section-foot { display: flex; align-items: center; gap: 8px; }
.new-section-foot .hint { flex: 1; font-size: var(--fs-sm); color: var(--text-faint); }

.file-overlay { position: fixed; inset: 0; z-index: var(--z-modal); display: flex; align-items: center; justify-content: center; padding: 32px; background: var(--overlay); backdrop-filter: blur(2px); }
.file-dialog { width: min(960px, 100%); max-height: 100%; }
</style>
