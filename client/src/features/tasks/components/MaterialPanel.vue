<template>
  <div class="material-tab" :class="{ 'with-review': material && reviewShown }">
    <div ref="main" class="material-main">
      <div v-if="lockedReason" class="banner" :class="done ? 'subtle' : 'warn'">
        <span>{{ lockedReason }}{{ done ? '' : '. Правка откроется, когда агенты закончат или будут ждать вашего ответа.' }}</span>
      </div>
      <div v-if="stage?.status === 'skipped'" class="banner subtle">
        <span>Раздел пропущен: {{ material ? 'черновик сохранён, но основанием для следующих этапов он не считается.' : 'материала нет.' }}</span>
      </div>
      <div v-else-if="stage?.status === 'ready' && stage.changed_since_mark" class="banner subtle">
        <span>Изменён после отметки «готово». Отметка не сброшена: завершите этап заново, когда закончите правки.</span>
      </div>

      <!-- With an agent: the document on the left, the chat on the right -->
      <template v-if="agentOpen && !done">
        <header class="material-bar">
          <div class="material-status" :class="{ live }"><span class="material-dot" />{{ live ? 'Агент работает над документом' : 'Работа с агентом' }}</div>
          <div class="material-actions">
            <AppButton variant="ghost" size="sm" title="Вернуться к документу. Чаты сохранятся" @click="agentOpen = false">Закрыть</AppButton>
          </div>
        </header>
        <SplitPane :storage-key="'plangent.material.' + type + '.agentShare'">
          <template #start>
            <section class="material-pane">
              <MessageMarkdown v-if="material" class="material-doc" :text="material.content" />
              <div v-else class="material-waiting">{{ live ? 'Ожидаем документ от агента…' : 'Документ появится здесь, когда агент его составит' }}</div>
            </section>
          </template>
          <template #end>
            <TaskChats :workspace-id="workspaceId" class="chat-pane" :label="L.chat" :chats="chats" :selected="selectedChat" :initials="initials" @select="$emit('selectChat', $event)" @remove="(id, name) => $emit('removeChat', id, name)">
              <template #new>
                <NewChatPanel :draft-key="`task:${taskId}:material-chat:${type}`"
                  :project-id="projectId" :workspace-id="workspaceId" :default-agent-id="defaultAgentId" :title="L.chatTitle" :text="material ? L.chatTextWith : L.chatTextEmpty"
                  :placeholder="material ? L.placeholderWith : L.placeholderEmpty" fixed-policy="read-only" :initial-text="material ? '' : L.draft"
                  :busy="launching" :error="launchError" @start="$emit('launch', $event)"
                />
              </template>
            </TaskChats>
          </template>
        </SplitPane>
      </template>

      <!-- Manual editing: text on the left, preview on the right -->
      <template v-else-if="editing && !done">
        <header class="material-bar">
          <div class="material-status">Правка вручную</div>
          <div class="material-actions">
            <AppButton variant="primary" size="sm" :disabled="saving || !!lockedReason" @click="save">{{ saving ? 'Сохранение…' : 'Сохранить' }}</AppButton>
            <AppButton variant="ghost" size="sm" :disabled="saving" @click="cancelEdit">Отмена</AppButton>
          </div>
        </header>
        <StaleDraftNote v-if="stale" @reload="reloadDocument" />
        <div v-if="stash" class="banner subtle"><span>Загружена новая версия документа.</span><AppButton size="xs" variant="ghost" @click="restoreStash">Вернуть мой текст</AppButton></div>
        <div v-if="error" class="banner danger" role="alert"><span>{{ error }}</span></div>
        <SplitPane :storage-key="'plangent.material.' + type + '.editShare'">
          <template #start>
            <AppTextarea v-model="draft" mono block class="material-editor" :aria-label="'Текст документа: ' + L.title" :placeholder="L.editorPlaceholder" spellcheck="false" />
          </template>
          <template #end>
            <section class="material-pane"><MessageMarkdown v-if="draft.trim()" class="material-doc" :text="draft" /><p v-else class="muted">Предпросмотр появится, когда вы начнёте писать. Схемы — блоки <code>```mermaid</code>.</p></section>
          </template>
        </SplitPane>
      </template>

      <!-- Empty state -->
      <div v-else-if="!material" class="material-content">
        <div class="material-empty">
          <div class="empty-title">{{ L.title }} необязательна</div>
          <p>{{ L.emptyText }}</p>
          <p>Можно сразу перейти дальше: этап отметится пропущенным.</p>
          <div v-if="!done" class="material-actions">
            <AppButton variant="primary" size="sm" :disabled="!!lockedReason" @click="agentOpen = true">▸ Составить с агентом</AppButton>
            <AppButton variant="ghost" size="sm" :disabled="!!lockedReason" @click="startEdit">Написать вручную</AppButton>
          </div>
          <p v-else class="muted">По задаче не было этого документа.</p>
        </div>
      </div>

      <!-- Document view -->
      <div v-else class="material-content">
        <div class="material-header">
          <span class="material-meta">Версия {{ material.version }} · {{ material.author === 'agent' ? 'агент' : 'разработчик' }}</span>
          <div v-if="!done" class="material-actions">
            <AppButton variant="blue" size="sm" :disabled="!!lockedReason" @click="agentOpen = true">▸ Изменить с агентом</AppButton>
            <AppButton variant="ghost" size="sm" :pressed="reviewOpen" :title="'Показать или скрыть ' + L.review.toLowerCase() + ' справа: агент проверит документ, замечания разбираете вы'" @click="reviewOpen = !reviewOpen">{{ L.review }}{{ attention ? ` (${attention})` : '' }}</AppButton>
            <AppButton variant="subtle" size="sm" :disabled="!!lockedReason" @click="startEdit">Редактировать вручную</AppButton>
          </div>
        </div>
        <MessageMarkdown class="material-doc" :text="material.content" />
      </div>
    </div>
    <PlanReviewPanel v-if="material" v-show="reviewShown" :project-id="projectId" :task-id="taskId" :target="type" :default-agent-id="defaultAgentId" :locked="!!lockedReason" :readonly="done" @highlight="highlight" @attention="attention = $event; $emit('reviewAttention', $event)" @close="reviewOpen = false" @open-planner="openAuthorChat" />
  </div>
</template>
<script setup lang="ts">
import AppTextarea from '@shared/ui/AppTextarea.vue'
import { useDraft } from '@core/composables/useDraft'
import StaleDraftNote from '@shared/ui/StaleDraftNote.vue'
import { computed, nextTick, ref, watch } from 'vue'
import PlanReviewPanel from './plan-review/PlanReviewPanel.vue'
import TaskChats from './TaskChats.vue'
import { NewChatPanel, MessageMarkdown, useComposerReveal, type NewChatRequest, type ContentBlock } from '@features/agent-chat'
import AppButton from '@shared/ui/AppButton.vue'
import SplitPane from '@shared/ui/SplitPane.vue'
import type { Material, MaterialType, StageSummary } from '@contracts'
import { preparationApi } from '../api'

const props = defineProps<{
  type: MaterialType
  material: Material | null
  openedIdentifier?: string
  stage?: StageSummary
  projectId: string
  workspaceId?: string | null
  taskId: string
  defaultAgentId?: string | null
  /** Why the document cannot be changed now (running queue, finished task); empty — it can. */
  lockedReason: string
  done: boolean
  chats: { id: string; title: string }[]
  selectedChat: string | null
  initials: Record<string, ContentBlock[]>
  launching: boolean
  launchError: string
  /** An author chat is starting or thinking right now. */
  live: boolean
}>()
const emit = defineEmits<{
  selectChat: [id: string | null]; removeChat: [id: string, name: string]; launch: [request: NewChatRequest]
  reload: []; reviewAttention: [count: number]
}>()

const texts = {
  architecture: {
    title: 'Архитектура', review: 'Ревью архитектуры', chat: 'Архитектура', chatTitle: 'Архитектура задачи',
    emptyText: 'Как изменение встраивается в систему: границы, ответственность, взаимодействия, решения с причинами, исключения. Схемы — текстом Mermaid.',
    chatTextEmpty: 'Опишите замысел или попросите набросок — агент изучит анализ и код и составит документ. В проекте он ничего не меняет, документ появится слева.',
    chatTextWith: 'Скажите, что изменить: оформить набросок, поправить решение, нарисовать схему. Агент изучит код и обновит документ.',
    placeholderEmpty: 'Опишите замысел…', placeholderWith: 'Что изменить в документе…', draft: 'Составь архитектуру по анализу задачи',
    editorPlaceholder: '## Контекст и границы\n\n## Компоненты и взаимодействия\n\n**D1** Решение и причина\n\n## Исключения и открытые вопросы',
  },
  qa: {
    title: 'QA', review: 'Ревью QA', chat: 'QA', chatTitle: 'QA задачи',
    emptyText: 'Требования на языке поведения программы: критерии с условием, действием и ожидаемым результатом. На них ссылаются шаги плана.',
    chatTextEmpty: 'Попросите составить критерии — агент изучит анализ и готовую архитектуру. В проекте он ничего не меняет, документ появится слева.',
    chatTextWith: 'Скажите, что изменить: уточнить критерий, добавить граничный случай, оформить набросок. Агент обновит документ.',
    placeholderEmpty: 'Что проверить…', placeholderWith: 'Что изменить в документе…', draft: 'Составь QA по анализу и архитектуре задачи',
    editorPlaceholder: '**Q1** Условие → действие → ожидаемый результат\n\n**Q2** …',
  },
}
const L = computed(() => texts[props.type])

// ——— Modes: view, chat with an agent, manual editing ———
const agentOpen = ref(false)
const documentDraft = useDraft(() => `task:${props.taskId}:material:${props.type}`, () => ({ active: false, text: '', version: 0, stash: '' }))
const editing = computed({ get: () => documentDraft.value.active, set: value => { documentDraft.value.active = value } })
const draft = computed({ get: () => documentDraft.value.text, set: value => { documentDraft.value.text = value } })
const baseVersion = computed({ get: () => documentDraft.value.version, set: value => { documentDraft.value.version = value } })
const stash = computed({ get: () => documentDraft.value.stash, set: value => { documentDraft.value.stash = value } })
const saving = ref(false), error = ref('')
const stale = computed(() => editing.value && (props.material?.version ?? 0) !== baseVersion.value)
function startEdit() {
  if (!editing.value) { draft.value = props.material?.content ?? ''; baseVersion.value = props.material?.version ?? 0 }
  error.value = ''; stash.value = ''
  editing.value = true
}
function cancelEdit() { editing.value = false; draft.value = ''; error.value = ''; stash.value = '' }
function reloadDocument() {
  stash.value = draft.value
  draft.value = props.material?.content ?? ''
  baseVersion.value = props.material?.version ?? 0
}
function restoreStash() { draft.value = stash.value; stash.value = '' }
async function save() {
  if (saving.value || props.lockedReason) return
  saving.value = true; error.value = ''
  try {
    await preparationApi.save(props.projectId, props.taskId, props.type, draft.value, baseVersion.value)
    editing.value = false; stash.value = ''
    emit('reload')
  } catch (cause) {
    // The text stays in the field; a rejected version shows up as `stale` once the new document arrives.
    error.value = String(cause).replace(/^Error:\s*/, '')
    emit('reload')
  } finally { saving.value = false }
}
watch(() => props.lockedReason, reason => { if (reason && editing.value && !saving.value) error.value = reason })
watch(() => props.done, done => { if (done) { agentOpen.value = false; editing.value = false } })

// ——— Review ———
const reviewOpen = ref(false), attention = ref(0)
// The review applies to the saved document: it is hidden while an agent or a manual edit works on the text.
const reviewShown = computed(() => reviewOpen.value && !agentOpen.value && !editing.value)
const main = ref<HTMLElement>()
// «В чат» without an open chat: the document switches to «with an agent», where the chat (or the new message field) is.
useComposerReveal(main, () => props, () => { if (!props.done) agentOpen.value = true })
function highlight(ids: string[]) {
  main.value?.querySelectorAll('.material-hl').forEach(el => el.classList.remove('material-hl'))
  const found = Array.from(main.value?.querySelectorAll('.material-doc strong') ?? []).filter(el => ids.includes(el.textContent?.trim() ?? ''))
  found.forEach(el => el.classList.add('material-hl'))
  void nextTick(() => found[0]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }))
}
watch(() => props.openedIdentifier, async identifier => {
  if (identifier === undefined) return
  agentOpen.value = false
  await nextTick()
  highlight(identifier ? [identifier] : [])
})
// A card that went to the author links to that author's chat.
function openAuthorChat(id: string) { agentOpen.value = true; emit('selectChat', id) }
</script>
<style scoped>
.material-tab { flex: 1; overflow: hidden; display: flex; flex-direction: column; min-height: 0; }
.material-tab.with-review { flex-direction: row; }
.material-main { flex: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column; overflow: hidden; }
.banner { display: flex; align-items: center; gap: 8px; flex-shrink: 0; margin: 12px 20px 0; font-size: var(--fs-sm); line-height: 1.45; padding: 8px 12px; border-radius: var(--radius-sm); border: 1px solid var(--border); background: var(--bg2); color: var(--text-muted); }
.banner > span { flex: 1; }
.banner.warn { border-color: var(--warning); background: var(--warning-soft); color: var(--warning-text); }
.banner.subtle { border-style: dashed; }
.banner.danger { border-color: var(--danger); background: var(--danger-soft); color: var(--danger-hover); }

.material-bar { display: flex; align-items: center; gap: 12px; padding: 8px 20px; border-bottom: 1px solid var(--border); background: var(--bg); flex-shrink: 0; margin-top: 12px; }
.material-status { display: flex; align-items: center; gap: 8px; font-size: var(--fs-md); font-weight: 600; color: var(--text-muted); }
.material-status.live { color: var(--warning-text); }
.material-dot { width: 8px; height: 8px; border-radius: var(--radius-round); background: var(--border-strong); }
.live .material-dot { background: var(--warning-text); animation: material-pulse 1.2s ease-in-out infinite; }
@keyframes material-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
.material-actions { margin-left: auto; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.material-actions .on { background: var(--bg3); color: var(--text); }

.material-pane { flex: 1; min-width: 0; overflow-y: auto; padding: 20px 24px; display: flex; flex-direction: column; }
.material-content { flex: 1; overflow-y: auto; padding: 16px 20px; display: flex; flex-direction: column; gap: 12px; }
.material-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.material-meta { font-size: var(--fs-sm); color: var(--text-muted); }
.material-header .material-actions { margin-left: 0; }
.material-waiting { flex: 1; display: flex; align-items: center; justify-content: center; text-align: center; color: var(--text-muted); font-size: var(--fs-md); min-height: 120px; }
.chat-pane { flex: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column; }
.material-editor { flex: 1; }
.material-doc :deep(.material-hl) { background: var(--blue-soft); box-shadow: 0 0 0 2px var(--blue-soft); border-radius: var(--radius-3); }
.material-empty { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 28px 24px; border: 1px dashed var(--border-strong); border-radius: var(--radius); text-align: center; font-size: var(--fs-md); line-height: 1.5; color: var(--text-muted); }
.material-empty p { max-width: 460px; }
.material-empty .material-actions { margin: 6px 0 0; justify-content: center; }
.empty-title { font-size: var(--fs-base); font-weight: 600; color: var(--text); }
.muted { color: var(--text-muted); font-size: var(--fs-md); }
</style>
