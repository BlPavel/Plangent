<template>
  <div class="it" :class="[state, item.status, decision ? 'decision-' + decision : '', { open, outdated: item.outdated, working, embedded }]">
    <div class="it-head" role="button" tabindex="0" :aria-expanded="open" @click="open = !open" @keydown.enter.self.prevent="open = !open" @keydown.space.self.prevent="open = !open">
      <span class="it-dot" :title="label" />
      <span v-if="location" class="it-loc">{{ location }}</span>
      <span v-if="item.author === 'agent' || permissions.length || kindLabel" class="it-flags">
        <span v-if="kindLabel" class="it-kind">{{ kindLabel }}</span>
        <span v-if="item.author === 'agent'" class="it-flag">агент</span>
        <span v-if="permissions.length" class="it-flag" title="Агент ждёт вашего разрешения">разрешение</span>
      </span>
      <span v-if="!open" class="it-summary" :class="{ below: !!location }">{{ summary }}</span>
      <span class="it-status">{{ label }}</span>
    </div>

    <div v-if="open" class="it-body">
      <pre v-if="item.outdated && item.code_snippet" class="it-snippet" title="Код, к которому относилось замечание">{{ item.code_snippet }}</pre>
      <div v-if="item.outdated" class="it-note">Код изменился, строка не найдена. Удалите пункт или превратите его в общий.</div>

      <div class="it-msg" :class="item.author">
        <div class="it-msg-head">{{ item.author === 'agent' ? 'Агент' : 'Вы' }} · {{ item.kind === 'question' ? 'вопрос' : 'замечание' }}</div>
        <MessageMarkdown :text="itemText" />
        <div v-if="item.refs.length" class="it-refs">
          <AppButton variant="link" size="xs" v-for="target in item.refs" :key="target" type="button"  :title="'Открыть: ' + target" @click="emit('open-ref', target)">@{{ target }}</AppButton>
        </div>
      </div>

      <div v-if="item.author === 'agent' && state === 'draft' && !readOnly && !item.outdated" class="it-note muted">
        {{ decision === 'accepted' ? 'Вы приняли замечание: оно уйдёт агенту на исправление по «Отправить».' : 'Замечание агента ждёт вашего решения. «Принять» — оно уйдёт на исправление по «Отправить»; «Обсудить» — напишите агенту: сообщение встанет в очередь и уйдёт по «Отправить».' }}
      </div>

      <div v-for="message in thread" :key="message.id" class="it-msg" :class="[message.author, message.kind, { queued: !message.sent }]">
        <div class="it-msg-head">
          {{ message.author === 'agent' ? 'Агент' : 'Вы' }}<template v-if="KIND_LABELS[message.kind]"> · {{ KIND_LABELS[message.kind] }}</template>
          <template v-if="!message.sent && !item.closed"> · в очереди</template>
        </div>
        <MessageMarkdown :text="discussionText(message)" />
        <div v-if="message.files.length" class="it-files">
          <span v-for="file in message.files" :key="file" class="it-file">{{ file }}</span>
        </div>
      </div>

      <div v-for="permission in permissions" :key="permission.permissionId" class="it-permission">
        <div class="it-msg-head">Агент просит разрешение</div>
        <div class="it-permission-title">{{ permission.toolCall.title }}</div>
        <div class="it-actions">
          <AppButton
            v-for="option in permission.options" :key="option.optionId" size="xs"
            :variant="option.kind.startsWith('allow') ? 'blue' : 'ghost'" @click="emit('permission', permission.permissionId, option.optionId)"
          >{{ option.name }}</AppButton>
        </div>
      </div>
      <div v-if="working && !permissions.length" class="it-working">{{ label }}</div>

      <!-- Everything the developer can do with the item is here, at the bottom: write, discuss, request changes, finish. -->
      <form v-if="!readOnly || canGoto" class="it-reply" @submit.prevent="submitText">
        <div v-if="canReply" class="it-reply-field">
          <SuggestMenu v-if="token" :anchor="area" title="Файлы и папки" :loading="loading" empty="Ничего не найдено" :items="suggestions" :active="active" @dismiss="dismissMentions" @pick="insertMention" @hover="active = $event" />
          <AppTextarea
            ref="areaComponent"
            v-model="text" :disabled="actionBusy" block rows="2" :placeholder="state === 'draft' ? 'Что в этом замечании непонятно или с чем вы не согласны? Написанное встанет в очередь и уйдёт агенту вместе с остальным. Ctrl+Enter — в очередь' : state === 'closed' ? 'Написать агенту (пункт откроется снова)…' : 'Ответить агенту…'"
            @input="updateToken" @click="updateToken" @keyup="mentionKeyUp" @keydown="replyKey" @paste="pasteFiles"
          />
        </div>
        <div v-if="canReply" class="it-attachments">
          <div v-if="files.length" class="it-attached-files">
            <AppChip v-for="(file, index) in files" :key="file.path" :title="file.path" :removable="!actionBusy" remove-label="Убрать" @remove="files.splice(index, 1)">📎 {{ file.name }}</AppChip>
          </div>
          <AppButton variant="subtle" size="xs" icon type="button" :disabled="actionBusy" title="Приложить файл или скриншот (можно вставить Ctrl+V)" aria-label="Приложить файл" @click="fileInput?.element?.click()"><UIIconAttach /></AppButton>
          <AppInput ref="fileInput" type="file" multiple hidden :disabled="actionBusy" @change="picked" />
          <span v-if="uploading" role="status">Прикрепляю…</span>
          <span v-else class="it-note muted">@ — файл или папка</span>
          <div v-if="attachError" class="it-note" role="alert">{{ attachError }}</div>
        </div>
        <div v-if="canGoto || item.outdated || mode !== 'none' || canReopen || (!readOnly && !item.closed) || $slots.extra" class="it-actions">
          <AppButton v-if="canGoto" class="it-act it-goto" size="xs" variant="ghost" type="button" @click="emit('goto')"><UIIconCode />К коду</AppButton>
          <AppButton v-if="item.outdated && !readOnly" class="it-act" size="xs" variant="ghost" type="button" @click="act('general')">Сделать общим</AppButton>
          <AppButton v-if="mode === 'draft' && decision && !item.outdated" class="it-act" size="xs" variant="ghost" type="button" @click="act('edit')">Править</AppButton>
          <slot name="extra" />
          <AppButton v-if="canReopen" class="it-act" size="xs" variant="blue" type="button" :disabled="actionBusy" title="Вернуть карточку к вашему решению" @click="reopenThread">Вернуть в доработку</AppButton>
          <AppButton v-if="!readOnly && !item.closed && state !== 'draft'" class="it-act" size="xs" variant="danger-ghost" type="button" :disabled="actionBusy" title="Закрыть обсуждение этого пункта" @click="closeThread">Закрыть</AppButton>
          <template v-if="mode === 'draft'">
            <AppButton class="it-act" size="xs" variant="danger-ghost" type="button" @click="act('remove')">Удалить</AppButton>
            <AppButton v-if="!item.outdated && !decision" class="it-act" size="xs" variant="ghost" type="button" @click="act('edit')">Править</AppButton>
          </template>
          <template v-else-if="mode === 'queued'">
            <AppButton class="it-act" size="xs" variant="ghost" type="button" :disabled="actionBusy" title="Убрать написанное из очереди: текст вернётся в поле ответа" @click="cancelQueued">Отменить</AppButton>
          </template>
          <template v-else-if="mode === 'typing'">
            <AppButton v-if="state === 'draft'" class="it-act" size="xs" variant="subtle" type="button" :disabled="actionBusy" @click="emit('stop-discussing')">Отмена</AppButton>
            <AppButton v-if="item.kind === 'question' && !noImplement && state !== 'draft'" class="it-act" size="xs" variant="primary" type="button" :disabled="actionBusy" title="Написанное станет заданием: агент внесёт изменения в код" @click="requestChange">Исправить</AppButton>
            <AppButton type="submit" class="it-act" size="xs" variant="blue" :disabled="actionBusy" title="Продолжить обсуждение: ответ уйдёт агенту со следующей отправкой">{{ item.kind === 'question' && state !== 'draft' ? 'Обсудить' : 'В очередь' }}</AppButton>
          </template>
          <template v-else-if="mode === 'idle'">
            <AppButton v-if="item.kind === 'question' && !noImplement" class="it-act" size="xs" variant="primary" type="button" :disabled="actionBusy" title="Попросить агента внести в код то, о чём договорились (уйдёт со следующей отправкой)" @click="requestChange">Исправить</AppButton>
          </template>
          <slot name="extra-end" />
        </div>
        <div v-if="error" class="it-note" role="alert">{{ error }}</div>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import AppTextarea from '@shared/ui/AppTextarea.vue'
import { AppChip, AppInput } from '@shared/ui'
import { useReviewAttachments } from '../composables/useReviewAttachments'
import { useDraft } from '@core/composables/useDraft'
import { computed, nextTick, ref, watch } from 'vue'
import { SuggestMenu, useMentionFiles, type SuggestItem } from '@features/agent-chat'
import AppButton from '@shared/ui/AppButton.vue'
import { IconCode as UIIconCode, IconAttach as UIIconAttach } from '@shared/ui/icons'
import { MessageMarkdown } from '@shared/markdown'
import type { CodeReviewItem, CodeReviewMessage } from '../types'
import { discussionText, stateLabel, type ThreadState } from '../utils/thread'

const props = defineProps<{
  projectId?: string | null
  workspaceId?: string | null
  draftKey?: string
  /** The developer's decision on the review agent's draft: accepted to be fixed, or still to decide. */
  decision?: 'accepted' | 'pending'
  item: CodeReviewItem
  thread: CodeReviewMessage[]
  state: ThreadState
  readOnly?: boolean
  embedded?: boolean
  /** Show the file and lines in the collapsed line and a «К коду» action (the right panel list). */
  showLocation?: boolean
  busy?: boolean
  error?: string
  /** Where the agent only reads (a merge request review) there is nothing to «Исправить». */
  noImplement?: boolean
  /** A flag in the head that names what the item is («вопрос»), for screens where the kinds are mixed. */
  kindLabel?: string
  /** The developer is writing to the agent about its draft remark (it is still a draft, so the reply box is opened by hand). */
  discussing?: boolean
  /** The agent said it works on this item now. */
  working?: boolean
  permissions?: { permissionId: string; toolCall: { title?: string | null }; options: { optionId: string; name: string; kind: string }[] }[]
}>()
const emit = defineEmits<{
  edit: []; remove: []; general: []; goto: []
  reply: [text: string, complete: (success: boolean) => void, kind: 'text' | 'implement']
  'remove-message': [id: string]
  close: [resolution: 'accept' | 'answered' | 'reject' | 'reopen', complete: (success: boolean) => void]
  permission: [permissionId: string, optionId: string]
  'stop-discussing': []
  'open-ref': [ref: string]
}>()

const KIND_LABELS: Record<string, string> = {
  implement: 'сделать', options: 'варианты', questions: 'уточняющие вопросы', change: 'изменил код', disagree: 'не согласен',
}
const pending = ref(false)
const actionBusy = computed(() => props.busy || pending.value || uploading.value)
const permissions = computed(() => props.permissions ?? [])
// Collapsed by default: the developer opens a thread themselves. Only a permission request opens it, since the agent is blocked on it.
const open = ref(permissions.value.length > 0)
watch(() => permissions.value.length > 0, value => { if (value) open.value = true })
watch(() => props.item.closed, closed => { if (closed) open.value = false })
const text = useDraft(() => props.draftKey ?? `code-review:${props.item.review_id}:item:${props.item.id}:text`, () => '')
const { files, uploading, attachError, onPaste, picked, attachedText } = useReviewAttachments(() => `${props.draftKey ?? `code-review:${props.item.review_id}:item:${props.item.id}:text`}:files`)
const fileInput = ref<InstanceType<typeof AppInput>>()
const hasReply = computed(() => !!text.value.trim() || files.value.length > 0)
function pasteFiles(event: ClipboardEvent) { if (!actionBusy.value) onPaste(event) }
const areaComponent = ref<InstanceType<typeof AppTextarea>>()
const area = computed(() => areaComponent.value?.element)
const active = ref(0)
const token = ref<{ start: number; end: number; query: string } | null>(null)
const { suggestions, loading, search, clear } = useMentionFiles(() => props.projectId ?? null, () => props.workspaceId)
function dismissMentions() { token.value = null; clear() }
watch(suggestions, () => { active.value = 0 })
function updateToken() {
  if (!area.value || actionBusy.value || area.value.selectionStart !== area.value.selectionEnd) { dismissMentions(); return }
  const caret = area.value.selectionStart
  const match = /(?:^|\s)@([^\s@]*)$/.exec(text.value.slice(0, caret))
  const previous = token.value
  token.value = match ? { start: caret - match[1].length - 1, end: caret, query: match[1] } : null
  if (!token.value) clear()
  else if (!previous || previous.query !== token.value.query) search(token.value.query)
}
function mentionKeyUp(event: KeyboardEvent) { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) updateToken() }
function insertMention(item: SuggestItem, commit = false) {
  const t = token.value
  if (!t || actionBusy.value) return
  const drill = item.dir && !commit
  const value = '@' + item.value + (drill ? '' : ' ')
  text.value = text.value.slice(0, t.start) + value + text.value.slice(t.end)
  dismissMentions()
  const caret = t.start + value.length
  void nextTick(() => { area.value?.focus(); area.value?.setSelectionRange(caret, caret); if (drill) updateToken() })
}
function replyKey(event: KeyboardEvent) {
  if (event.isComposing || actionBusy.value) return
  if (event.key === 'Escape' && token.value) { event.preventDefault(); event.stopPropagation(); dismissMentions(); return }
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); submitText(); return }
  if (!token.value || !suggestions.value.length) return
  if (event.key === 'ArrowDown') { event.preventDefault(); active.value = (active.value + 1) % suggestions.value.length }
  else if (event.key === 'ArrowUp') { event.preventDefault(); active.value = (active.value - 1 + suggestions.value.length) % suggestions.value.length }
  else if ((event.key === 'Tab' || event.key === 'Enter') && !event.shiftKey) { event.preventDefault(); insertMention(suggestions.value[active.value], event.key === 'Tab') }
}

const label = computed(() => (props.item.outdated ? 'Устарело' : props.decision === 'accepted' ? '✓ Принято' : props.decision === 'pending' ? 'Ждёт решения' : stateLabel(props.item, props.state, props.working)))
/** Questions written with the «?» shortcut before it was dropped on save still carry the mark. */
const itemText = computed(() => (props.item.kind === 'question' ? props.item.text.replace(/^\s*\?+\s*/, '') : props.item.text))
const summary = computed(() => itemText.value.replace(/\s+/g, ' ').trim())
/** What the developer wrote and has not sent yet. */
const queuedReplies = computed(() => props.thread.filter(m => m.author === 'developer' && !m.sent))
const canReply = computed(() => !props.readOnly && (props.state !== 'draft' || props.discussing) && (props.item.closed || !queuedReplies.value.length))
watch(() => [props.item.id, props.draftKey, props.projectId, props.workspaceId, open.value, canReply.value], dismissMentions)
const canReopen = computed(() => !props.readOnly && props.item.closed && ['done', 'answered'].includes(props.item.status))
const canGoto = computed(() => !!props.showLocation && !!props.item.file && !props.item.outdated)
/** What the bottom bar offers: the item's own actions, what to do with a written reply, or how to answer the agent. */
const mode = computed<'draft' | 'queued' | 'typing' | 'idle' | 'none'>(() => {
  if (props.readOnly) return 'none'
  if (props.item.closed) return hasReply.value ? 'typing' : 'none'
  if (props.state === 'draft') return props.discussing ? 'typing' : 'draft'
  if (queuedReplies.value.length) return 'queued'
  if (hasReply.value) return 'typing'
  return props.state === 'waiting' && !props.item.closed ? 'idle' : 'none'
})
/** Takes back the written reply: it leaves the queue and returns to the reply box, ready to be changed. */
function cancelQueued() {
  const back = queuedReplies.value.map(m => m.text).join('\n\n')
  for (const message of queuedReplies.value) emit('remove-message', message.id)
  if (!text.value.trim()) text.value = back
}
const location = computed(() => {
  if (!props.showLocation) return ''
  const { file, line_start, line_end, scope, side } = props.item
  if (scope === 'general' || !file) return 'общее'
  const name = file.slice(file.lastIndexOf('/') + 1)
  if (scope === 'file') return name
  return `${name}:${line_start}${line_end && line_end !== line_start ? '–' + line_end : ''}${side === 'old' ? ' (было)' : ''}`
})
/** Any action on the card folds it: the state label says what happens next, the thread opens again by a click. */
const actions = { edit: () => emit('edit'), remove: () => emit('remove'), general: () => emit('general') }
function act(name: keyof typeof actions) {
  actions[name]()
  open.value = false
}
function reopenThread() {
  if (actionBusy.value || !canReopen.value) return
  pending.value = true
  emit('close', 'reopen', success => {
    pending.value = false
    if (success) open.value = true
  })
}
function closeThread() {
  if (actionBusy.value) return
  pending.value = true
  emit('close', props.item.status === 'done' ? 'accept' : props.item.status === 'needs_decision' ? 'reject' : 'answered', success => {
    pending.value = false
    if (success) open.value = false
  })
}
/**
 * A question turns into a task: what was written (or, without text, what was agreed on in the thread) becomes the request
 * to change the code. It waits for the next «Отправить» like any other reply.
 */
function requestChange() {
  if (actionBusy.value) return
  const written = text.value.trim()
  sendReply(written ? 'Исправь: ' + written : 'Выполни то, о чём мы договорились в обсуждении: внеси изменения в код.', 'implement')
}
function submitText() {
  if (!hasReply.value || actionBusy.value) return
  sendReply(text.value.trim())
}
function sendReply(message: string, kind: 'text' | 'implement' = 'text') {
  const written = text.value
  const attached = [...files.value]
  const owner = props.item.id
  const key = props.draftKey
  const target = files.value
  const body = [message, attachedText()].filter(Boolean).join('\n\n')
  pending.value = true
  emit('reply', body, success => {
    pending.value = false
    if (!success) return
    if (props.item.id === owner && props.draftKey === key && text.value === written) text.value = ''
    for (const file of attached) {
      const index = target.indexOf(file)
      if (index >= 0) target.splice(index, 1)
    }
    open.value = false
  }, kind)
}
</script>

<style scoped>
.it-reply-field { position: relative; }
.it-attachments { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.it-attached-files { display: flex; flex-wrap: wrap; gap: 4px; flex-basis: 100%; }
.it { container-type: inline-size; border: 1px solid var(--border-strong); border-left-width: 3px; border-radius: var(--radius-sm); background: var(--bg2); font-size: var(--fs-sm); }
.it.embedded { background: var(--bg3); border-top-color: var(--blue); border-right-color: var(--blue); border-bottom-color: var(--blue); box-shadow: 0 2px 10px var(--overlay-soft); }
.it.embedded .it-summary { font-weight: var(--fw-medium); }
.it.draft { border-left-color: var(--text-faint); }
.it.queued { border-left-color: var(--blue); border-left-style: dashed; }
.it.agent { border-left-color: var(--blue); }
.it.waiting { border-left-color: var(--warning-text); }
.it.waiting.done { border-left-color: var(--accent-hover); }
.it.closed { border-left-color: var(--border-strong); opacity: 0.75; }
.it.outdated { border-style: dashed; }
/* The review agent's drafts: the developer sees at a glance which are accepted and which still wait. */
.it.decision-pending { border-left-color: var(--warning-text); }
.it.decision-pending .it-dot, .it.decision-pending .it-status { color: var(--warning-text); }
.it.decision-accepted { border-left-color: var(--accent-hover); }
.it.decision-accepted .it-dot, .it.decision-accepted .it-status { color: var(--accent-hover); font-weight: var(--fw-semibold); }
/* Narrow panel: the meta (place, flags, state) on the first line, the summary on its own line below it */
.it-line { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 6px; width: 100%; padding: 4px 8px; font: inherit; text-align: left; color: var(--text); background: none; border: none; cursor: pointer; }
.it-dot { width: 7px; height: 7px; flex-shrink: 0; margin-top: 6px; border-radius: var(--radius-round); background: currentColor; color: var(--text-faint); }
.it.agent .it-dot, .it.queued .it-dot { color: var(--blue-hover); }
.it.working .it-dot { animation: it-pulse 1.4s ease-in-out infinite; }
.it.waiting .it-dot { color: var(--warning-text); }
.it.waiting.done .it-dot { color: var(--accent-hover); }
@keyframes it-pulse { 50% { opacity: 0.3; } }
.it-head { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 2px 6px; min-width: 0; max-width: 100%; padding: 5px 8px; cursor: pointer; outline: none; }
.it-head:hover { background: var(--bg3); }
.it-head:focus-visible { outline: var(--focus-outline); outline-offset: -2px; }
.it-flags { display: flex; gap: 4px; flex: 0 1 auto; min-width: 0; }
.it-loc { flex: 1 1 0; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; line-height: var(--lh-normal); color: var(--text-muted); }
.it-summary { flex: 1 1 0; min-width: 0; overflow: hidden; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; line-height: var(--lh-normal); color: var(--text); overflow-wrap: anywhere; }
.it-summary.below { flex-basis: 100%; order: 2; }
.it-kind { flex-shrink: 0; padding: 1px 8px; line-height: var(--lh-normal); font-size: var(--fs-xs); font-weight: var(--fw-medium); border: 1px solid var(--accent-hover); border-radius: var(--radius-pill); color: var(--accent-hover); white-space: nowrap; }
.it-flag { flex: 0 1 auto; min-width: 0; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 0 6px; font-size: var(--fs-xs); font-weight: 600; border-radius: var(--radius-pill); background: var(--blue); color: var(--on-accent); }
.it-status { flex-shrink: 0; margin-left: auto; line-height: var(--lh-normal); font-size: var(--fs-xs); color: var(--text-muted); }
.it.waiting .it-status { color: var(--warning-text); font-weight: 600; }
.it.waiting.done .it-status { color: var(--accent-hover); }
.it-body { display: flex; flex-direction: column; gap: 6px; padding: 2px 10px 8px; white-space: normal; }
.it-snippet { margin: 0; padding: 4px 8px; max-height: 120px; overflow: auto; font-size: var(--fs-xs); background: var(--bg); border-radius: var(--radius-sm); color: var(--text-muted); }
.it-note { color: var(--warning-text); }
.it-note.muted { color: var(--text-muted); font-size: var(--fs-xs); }
.it-msg { padding: 5px 8px; border-radius: var(--radius-sm); background: var(--bg); }
.it-msg.developer { border-left: 2px solid var(--text-faint); }
.it-msg.agent { border-left: 2px solid var(--blue); }
.it-msg.agent.change { border-left-color: var(--accent-hover); }
.it-msg.agent.disagree { border-left-color: var(--warning-text); }
.it-msg.queued { border-left-style: dashed; opacity: 0.85; }
.it-msg-head { margin-bottom: 2px; font-size: var(--fs-xs); font-weight: 600; color: var(--text-muted); }
.it-link { padding: 0 2px; font: inherit; font-weight: 400; color: var(--blue-hover); background: none; border: none; cursor: pointer; }
.it-link:hover { text-decoration: underline; }
.it-refs, .it-files { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; margin-top: 4px; }
.it-ref { padding: 0 6px; font: inherit; font-size: var(--fs-xs); color: var(--blue-hover); background: var(--bg2); border: 1px solid var(--border-strong); border-radius: var(--radius-pill); cursor: pointer; }
.it-file { padding: 0 6px; font-family: var(--font-mono); font-size: var(--fs-xs); color: var(--text-muted); background: var(--bg2); border-radius: var(--radius-pill); }
.it-permission { padding: 6px 8px; border: 1px solid var(--blue); border-radius: var(--radius-sm); background: var(--blue-soft); }
.it-permission-title { margin-bottom: 6px; font-family: var(--font-mono); font-size: var(--fs-sm); overflow-wrap: anywhere; }
.it-working { font-size: var(--fs-xs); color: var(--blue-hover); }
.it-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; }
.it-actions:empty { display: none; }
.it-reply { display: flex; flex-direction: column; gap: 4px; }

/* Every action of the bar is the same width, so the row reads as one set; only the colour tells main from the rest. */
.it-act, :slotted(.it-accept) { flex: 0 0 auto; min-width: 76px; }
.it-goto { margin-right: auto; }
.it-reply .it-actions { justify-content: flex-end; gap: 6px; padding-top: 8px; border-top: 1px solid var(--border); }
</style>
