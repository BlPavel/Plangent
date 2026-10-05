<template>
  <div class="it" :class="[state, item.status, { open, outdated: item.outdated, working }]">
    <button type="button" class="it-line" :aria-expanded="open" @click="open = !open">
      <span class="it-dot" :title="label" />
      <span class="it-kind" :title="item.kind === 'question' ? 'Вопрос' : 'Замечание'">{{ item.kind === 'question' ? '?' : '!' }}</span>
      <span v-if="location" class="it-loc">{{ location }}</span>
      <span class="it-summary">{{ summary }}</span>
      <span v-if="permissions.length" class="it-flag" title="Агент ждёт вашего разрешения">разрешение</span>
      <span class="it-status">{{ label }}</span>
    </button>

    <div v-if="open" class="it-body">
      <pre v-if="item.outdated && item.code_snippet" class="it-snippet" title="Код, к которому относилось замечание">{{ item.code_snippet }}</pre>
      <div v-if="item.outdated" class="it-note">Код изменился, строка не найдена. Удалите пункт или превратите его в общий.</div>

      <div class="it-msg developer">
        <div class="it-msg-head">Вы · {{ item.kind === 'question' ? 'вопрос' : 'замечание' }}</div>
        <MessageMarkdown :text="item.text" />
        <div v-if="item.refs.length" class="it-refs">
          <button v-for="target in item.refs" :key="target" type="button" class="it-ref" :title="'Открыть: ' + target" @click="emit('open-ref', target)">@{{ target }}</button>
        </div>
      </div>

      <div v-for="message in thread" :key="message.id" class="it-msg" :class="[message.author, message.kind, { queued: !message.sent }]">
        <div class="it-msg-head">
          {{ message.author === 'agent' ? 'Агент' : 'Вы' }}<template v-if="KIND_LABELS[message.kind]"> · {{ KIND_LABELS[message.kind] }}</template>
          <template v-if="!message.sent"> · в очереди
            <button v-if="!readOnly" type="button" class="it-link" title="Убрать ответ из очереди" @click="emit('remove-message', message.id)">убрать</button>
          </template>
        </div>
        <MessageMarkdown :text="message.text" />
        <div v-if="message.options.length" class="it-options" role="radiogroup">
          <label
            v-for="(option, index) in message.options" :key="index" class="it-option"
            :class="{ picked: pickable(message) ? pick === index : chosenFor(message) === index, recommended: option.recommended }"
          >
            <input v-if="pickable(message)" v-model="pick" type="radio" :value="index" />
            <span class="it-option-n">{{ index + 1 }}</span>
            <span class="it-option-text">{{ option.label }}</span>
            <span v-if="option.recommended" class="it-badge">рекомендую</span>
          </label>
        </div>
        <div v-if="message.files.length || (message.kind === 'change' && message.round_id)" class="it-files">
          <span v-for="file in message.files" :key="file" class="it-file">{{ file }}</span>
          <button v-if="message.round_id" type="button" class="it-link" title="Diff правок агента за этот заход" @click="emit('show-change', message.round_id, message.files[0])">Посмотреть правку</button>
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
      <div v-if="working && !permissions.length" class="it-working">Агент работает над этим пунктом…</div>

      <div v-if="!readOnly" class="it-actions">
        <template v-if="state === 'draft'">
          <AppButton v-if="!item.outdated" size="xs" variant="ghost" @click="emit('edit')">Править</AppButton>
          <AppButton v-if="item.outdated" size="xs" variant="ghost" @click="emit('general')">Сделать общим</AppButton>
          <AppButton size="xs" variant="danger-ghost" @click="emit('remove')">Удалить</AppButton>
          <AppButton v-if="!item.outdated" size="xs" variant="ghost" :disabled="agentBusy" :title="busyTitle" @click="emit('send-now')">Отправить сейчас</AppButton>
        </template>
        <template v-else-if="state === 'waiting'">
          <template v-if="item.status === 'done'">
            <AppButton size="xs" variant="blue" :disabled="busy" title="Правка устраивает: пункт закроется" @click="emit('close', 'accept')">Принять</AppButton>
          </template>
          <template v-else-if="item.status === 'needs_decision'">
            <AppButton size="xs" variant="ghost" :disabled="busy" title="Принять довод агента: пункт закроется как отклонённый" @click="emit('close', 'reject')">Согласен с агентом</AppButton>
            <AppButton size="xs" variant="ghost" :disabled="busy" title="Агент сделает как в замечании (уйдёт со следующей отправкой)" @click="reply('implement', 'Настаиваю: сделай как в замечании.')">Настаиваю</AppButton>
          </template>
          <template v-else>
            <AppButton
              v-if="lastOptions" size="xs" variant="blue" :disabled="busy || pick === null"
              :title="pick === null ? 'Выберите вариант выше' : 'Агент сделает выбранный вариант (уйдёт со следующей отправкой)'" @click="implementPick"
            >Сделать выбранный</AppButton>
            <AppButton v-else size="xs" variant="ghost" :disabled="busy" title="Агент внесёт изменение по своему ответу" @click="reply('implement', 'Согласен, сделай так.')">Сделать так</AppButton>
            <AppButton size="xs" variant="ghost" :disabled="busy" @click="reply('text', 'Задай ещё уточняющие вопросы, прежде чем менять код.')">Задай ещё вопросы</AppButton>
            <AppButton size="xs" variant="ghost" :disabled="busy" title="Ответа достаточно: пункт закроется" @click="emit('close', 'answered')">Закрыть</AppButton>
          </template>
        </template>
        <template v-else-if="state === 'queued'">
          <AppButton size="xs" variant="ghost" :disabled="agentBusy" :title="busyTitle" @click="emit('send-now')">Отправить сейчас</AppButton>
        </template>
        <template v-else-if="state === 'closed'">
          <AppButton size="xs" variant="ghost" :disabled="busy" @click="emit('close', 'reopen')">Открыть снова</AppButton>
        </template>
        <AppButton v-if="item.outdated && state !== 'draft'" size="xs" variant="ghost" @click="emit('general')">Сделать общим</AppButton>
        <AppButton v-if="showLocation && item.file && !item.outdated" size="xs" variant="ghost" @click="emit('goto')">К коду</AppButton>
      </div>
      <div v-else-if="showLocation && item.file && !item.outdated" class="it-actions">
        <AppButton size="xs" variant="ghost" @click="emit('goto')">К коду</AppButton>
      </div>

      <form v-if="!readOnly && state !== 'draft'" class="it-reply" @submit.prevent="submitText">
        <textarea
          v-model="text" class="it-input" rows="2" :placeholder="state === 'closed' ? 'Написать агенту (пункт откроется снова)…' : 'Ответить агенту…'"
          @keydown.enter.ctrl.prevent="submitText" @keydown.enter.meta.prevent="submitText"
        />
        <div class="it-reply-bar">
          <span class="it-hint">Ответ уйдёт со следующей отправкой · Ctrl+Enter</span>
          <AppButton type="submit" size="xs" variant="ghost" :disabled="busy || !text.trim()">В очередь</AppButton>
        </div>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import AppButton from '@shared/ui/AppButton.vue'
import MessageMarkdown from '@shared/ui/MessageMarkdown.vue'
import type { CodeReviewItem, CodeReviewMessage } from '../types'
import { stateLabel, type ThreadState } from '../utils/thread'

const props = defineProps<{
  item: CodeReviewItem
  thread: CodeReviewMessage[]
  state: ThreadState
  readOnly?: boolean
  /** Show the file and lines in the collapsed line and a «К коду» action (the right panel list). */
  showLocation?: boolean
  busy?: boolean
  /** The agent has a turn running: sending is not possible now. */
  agentBusy?: boolean
  /** The agent said it works on this item now. */
  working?: boolean
  permissions?: { permissionId: string; toolCall: { title: string }; options: { optionId: string; name: string; kind: string }[] }[]
}>()
const emit = defineEmits<{
  edit: []; remove: []; general: []; goto: []; 'send-now': []
  reply: [kind: 'text' | 'implement', text: string, choice?: number]
  'remove-message': [id: string]
  close: [resolution: 'accept' | 'answered' | 'reject' | 'reopen']
  permission: [permissionId: string, optionId: string]
  'show-change': [roundId: string, file?: string]
  'open-ref': [ref: string]
}>()

const KIND_LABELS: Record<string, string> = {
  implement: 'сделать', options: 'варианты', questions: 'уточняющие вопросы', change: 'изменил код', disagree: 'не согласен',
}
const permissions = computed(() => props.permissions ?? [])
// Collapsed by default: the developer opens a thread themselves. Only a permission request opens it, since the agent is blocked on it.
const open = ref(permissions.value.length > 0)
watch(() => permissions.value.length > 0, value => { if (value) open.value = true })
const text = ref('')
const pick = ref<number | null>(null)

const label = computed(() => (props.item.outdated ? 'Устарело' : stateLabel(props.item, props.state)))
const summary = computed(() => props.item.text.replace(/\s+/g, ' ').trim())
const busyTitle = computed(() => (props.agentBusy ? 'Агент работает: дождитесь конца хода' : 'Отправить только этот пункт, не дожидаясь остальных'))
const location = computed(() => {
  if (!props.showLocation) return ''
  const { file, line_start, line_end, scope, side } = props.item
  if (scope === 'general' || !file) return 'общее'
  const name = file.slice(file.lastIndexOf('/') + 1)
  if (scope === 'file') return name
  return `${name}:${line_start}${line_end && line_end !== line_start ? '–' + line_end : ''}${side === 'old' ? ' (было)' : ''}`
})
/** The agent's last message, when it offers options the developer can still pick from. */
const lastAgent = computed(() => [...props.thread].reverse().find(m => m.author === 'agent') ?? null)
const lastOptions = computed(() => (props.state === 'waiting' && lastAgent.value?.options.length ? lastAgent.value : null))
const pickable = (message: CodeReviewMessage) => !props.readOnly && message === lastOptions.value
/** The option a later «Сделать выбранный» of the developer picked from this message. */
const chosenFor = (message: CodeReviewMessage) => {
  const index = props.thread.indexOf(message)
  return props.thread.slice(index + 1).find(m => m.author === 'developer' && m.choice !== null)?.choice ?? null
}
watch(lastOptions, message => { pick.value = message ? message.options.findIndex(o => o.recommended) : null; if (pick.value === -1) pick.value = null }, { immediate: true })

function reply(kind: 'text' | 'implement', value: string, choice?: number) { emit('reply', kind, value, choice) }
function implementPick() {
  const option = lastOptions.value?.options[pick.value ?? -1]
  if (option) reply('implement', `Сделай вариант ${pick.value! + 1}: ${option.label}`, pick.value!)
}
function submitText() {
  if (!text.value.trim() || props.busy) return
  reply('text', text.value.trim())
  text.value = ''
}
</script>

<style scoped>
.it { border: 1px solid var(--border-strong); border-left-width: 3px; border-radius: var(--radius-sm); background: var(--bg2); font-size: 12px; }
.it.draft { border-left-color: var(--text-faint); }
.it.queued { border-left-color: var(--blue); border-left-style: dashed; }
.it.agent { border-left-color: var(--blue); }
.it.waiting { border-left-color: var(--warning-text); }
.it.waiting.done { border-left-color: var(--accent-hover); }
.it.closed { border-left-color: var(--border-strong); opacity: 0.75; }
.it.outdated { border-style: dashed; }
.it-line { display: flex; align-items: center; gap: 6px; width: 100%; padding: 3px 8px; font: inherit; text-align: left; color: var(--text); background: none; border: none; cursor: pointer; }
.it-dot { width: 7px; height: 7px; flex-shrink: 0; border-radius: 50%; background: currentColor; color: var(--text-faint); }
.it.agent .it-dot, .it.queued .it-dot { color: var(--blue-hover); }
.it.working .it-dot { animation: it-pulse 1.4s ease-in-out infinite; }
.it.waiting .it-dot { color: var(--warning-text); }
.it.waiting.done .it-dot { color: var(--accent-hover); }
@keyframes it-pulse { 50% { opacity: 0.3; } }
.it-kind { flex-shrink: 0; width: 12px; font-weight: 700; color: var(--text-muted); text-align: center; }
.it-loc { flex-shrink: 0; max-width: 45%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: monospace; font-size: 11px; color: var(--text-muted); }
.it-summary { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.it.open .it-summary { visibility: hidden; flex: 0; }
.it-flag { flex-shrink: 0; padding: 0 6px; font-size: 10px; font-weight: 600; border-radius: var(--radius-pill); background: var(--blue); color: #fff; }
.it-status { flex-shrink: 0; margin-left: auto; font-size: 11px; color: var(--text-muted); }
.it.waiting .it-status { color: var(--warning-text); font-weight: 600; }
.it.waiting.done .it-status { color: var(--accent-hover); }
.it-body { display: flex; flex-direction: column; gap: 6px; padding: 2px 10px 8px; white-space: normal; }
.it-snippet { margin: 0; padding: 4px 8px; max-height: 120px; overflow: auto; font-size: 11px; background: var(--bg); border-radius: var(--radius-sm); color: var(--text-muted); }
.it-note { color: var(--warning-text); }
.it-msg { padding: 5px 8px; border-radius: var(--radius-sm); background: var(--bg); }
.it-msg.developer { border-left: 2px solid var(--text-faint); }
.it-msg.agent { border-left: 2px solid var(--blue); }
.it-msg.agent.change { border-left-color: var(--accent-hover); }
.it-msg.agent.disagree { border-left-color: var(--warning-text); }
.it-msg.queued { border-left-style: dashed; opacity: 0.85; }
.it-msg-head { margin-bottom: 2px; font-size: 11px; font-weight: 600; color: var(--text-muted); }
.it-link { padding: 0 2px; font: inherit; font-weight: 400; color: var(--blue-hover); background: none; border: none; cursor: pointer; }
.it-link:hover { text-decoration: underline; }
.it-refs, .it-files { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; margin-top: 4px; }
.it-ref { padding: 0 6px; font: inherit; font-size: 11px; color: var(--blue-hover); background: var(--bg2); border: 1px solid var(--border-strong); border-radius: var(--radius-pill); cursor: pointer; }
.it-file { padding: 0 6px; font-family: monospace; font-size: 11px; color: var(--text-muted); background: var(--bg2); border-radius: var(--radius-pill); }
.it-options { display: flex; flex-direction: column; gap: 3px; margin-top: 4px; }
.it-option { display: flex; align-items: baseline; gap: 6px; padding: 4px 6px; border: 1px solid var(--border-strong); border-radius: var(--radius-sm); cursor: pointer; }
.it-option input { margin: 0; accent-color: var(--blue); }
.it-option.picked { border-color: var(--blue); background: var(--blue-soft); }
.it-option-n { flex-shrink: 0; font-weight: 600; color: var(--text-muted); }
.it-option-text { flex: 1; min-width: 0; }
.it-badge { flex-shrink: 0; padding: 0 6px; font-size: 10px; border-radius: var(--radius-pill); background: var(--accent-soft); color: var(--accent-hover); }
.it-permission { padding: 6px 8px; border: 1px solid var(--blue); border-radius: var(--radius-sm); background: var(--blue-soft); }
.it-permission-title { margin-bottom: 6px; font-family: monospace; font-size: 11.5px; overflow-wrap: anywhere; }
.it-working { font-size: 11px; color: var(--blue-hover); }
.it-actions { display: flex; flex-wrap: wrap; gap: 4px; }
.it-actions:empty { display: none; }
.it-reply { display: flex; flex-direction: column; gap: 4px; }
.it-input { width: 100%; box-sizing: border-box; padding: 5px 8px; font: inherit; font-size: 12px; color: var(--text); background: var(--bg); border: 1px solid var(--border-strong); border-radius: var(--radius-sm); resize: vertical; }
.it-input:focus { outline: none; border-color: var(--blue); }
.it-reply-bar { display: flex; align-items: center; gap: 6px; }
.it-hint { flex: 1; font-size: 11px; color: var(--text-faint); }
</style>
