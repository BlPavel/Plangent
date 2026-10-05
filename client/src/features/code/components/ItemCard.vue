<template>
  <div class="it" :class="[item.status, { open, outdated: item.outdated, picked: selected }]">
    <div class="it-head">
      <input
        v-if="selectable" type="checkbox" class="it-check" :checked="selected" :aria-label="'Выбрать: ' + summary"
        title="Выбрать для отправки агенту" @change="emit('toggle')"
      />
      <button type="button" class="it-line" :aria-expanded="open" @click="open = !open">
        <span class="it-dot" :title="statusLabel" />
        <span class="it-kind" :title="item.kind === 'question' ? 'Вопрос' : 'Замечание'">{{ item.kind === 'question' ? '?' : '!' }}</span>
        <span v-if="location" class="it-loc">{{ location }}</span>
        <span class="it-summary">{{ summary }}</span>
        <span class="it-status">{{ statusLabel }}</span>
      </button>
    </div>
    <div v-if="open" class="it-body">
      <pre v-if="item.outdated && item.code_snippet" class="it-snippet" title="Код, к которому относилось замечание">{{ item.code_snippet }}</pre>
      <div v-if="item.outdated" class="it-note">Код изменился, строка не найдена. Удалите пункт или превратите его в общий.</div>
      <MessageMarkdown :text="item.text" />
      <div v-if="item.refs.length" class="it-refs">
        <button v-for="target in item.refs" :key="target" type="button" class="it-ref" :title="'Открыть в дереве: ' + target" @click="emit('open-ref', target)">@{{ target }}</button>
      </div>
      <div v-if="item.answer" class="it-answer">
        <div class="it-answer-title">{{ item.status === 'needs_decision' ? 'Агент не согласен' : 'Ответ агента' }}</div>
        <MessageMarkdown :text="item.answer" />
      </div>
      <div class="it-actions">
        <template v-if="!readOnly">
          <template v-if="item.status === 'draft'">
            <AppButton v-if="!item.outdated" size="xs" variant="ghost" @click="emit('edit')">Править</AppButton>
            <AppButton v-if="item.outdated" size="xs" variant="ghost" @click="emit('general')">Сделать общим</AppButton>
            <AppButton size="xs" variant="danger-ghost" @click="emit('remove')">Удалить</AppButton>
          </template>
          <template v-else-if="item.status === 'answered' && item.kind === 'question'">
            <AppButton size="xs" variant="ghost" :disabled="busy || agentWorking" :title="agentWorking ? 'Агент отвечает' : 'Согласен с ответом: агент внесёт изменение'" @click="emit('implement')">Сделать</AppButton>
          </template>
          <template v-else-if="item.status === 'needs_decision'">
            <AppButton size="xs" variant="ghost" :disabled="busy" title="Принять довод агента: пункт закроется как отклонённый" @click="emit('decide', 'agree')">Согласен с агентом</AppButton>
            <AppButton size="xs" variant="ghost" :disabled="busy || agentWorking" :title="agentWorking ? 'Агент отвечает' : 'Агент сделает как в замечании'" @click="emit('decide', 'insist')">Настаиваю</AppButton>
            <AppButton size="xs" variant="ghost" @click="emit('discuss')">Обсудить в чате</AppButton>
          </template>
          <template v-else-if="item.outdated">
            <AppButton size="xs" variant="ghost" @click="emit('general')">Сделать общим</AppButton>
            <AppButton size="xs" variant="danger-ghost" @click="emit('remove')">Удалить</AppButton>
          </template>
        </template>
        <AppButton v-if="item.status !== 'draft' && item.status !== 'needs_decision' && item.round_id" size="xs" variant="ghost" @click="emit('discuss')">В чат</AppButton>
        <AppButton v-if="showLocation && item.file && !item.outdated" size="xs" variant="ghost" @click="emit('goto')">К коду</AppButton>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import AppButton from '@shared/ui/AppButton.vue'
import MessageMarkdown from '@shared/ui/MessageMarkdown.vue'
import type { CodeReviewItem } from '../types'

const props = defineProps<{
  item: CodeReviewItem
  readOnly?: boolean
  /** Show the file and lines in the collapsed line and a «К коду» action (the right panel list). */
  showLocation?: boolean
  busy?: boolean
  agentWorking?: boolean
  /** Shows a checkbox: the item can be sent to an agent. */
  selectable?: boolean
  selected?: boolean
}>()
const emit = defineEmits<{
  edit: []; remove: []; general: []; goto: []; discuss: []
  decide: [decision: 'agree' | 'insist']
  toggle: []; implement: []
  'open-ref': [ref: string]
}>()
const open = ref(props.item.status === 'needs_decision')

const LABELS: Record<CodeReviewItem['status'], string> = {
  draft: 'Черновик', sent: 'У агента', done: 'Исправлено', answered: 'Отвечено', needs_decision: 'Нужно ваше решение', rejected: 'Отклонено',
}
const statusLabel = computed(() => (props.item.outdated ? 'Устарело' : LABELS[props.item.status]))
const summary = computed(() => props.item.text.replace(/\s+/g, ' ').trim())
const location = computed(() => {
  if (!props.showLocation) return ''
  const { file, line_start, line_end, scope, side } = props.item
  if (scope === 'general' || !file) return 'общее'
  const name = file.slice(file.lastIndexOf('/') + 1)
  if (scope === 'file') return name
  return `${name}:${line_start}${line_end && line_end !== line_start ? '–' + line_end : ''}${side === 'old' ? ' (было)' : ''}`
})
</script>

<style scoped>
.it { border: 1px solid var(--border-strong); border-left-width: 3px; border-radius: var(--radius-sm); background: var(--bg2); font-size: 12px; }
.it.draft { border-left-color: var(--text-faint); }
.it.sent { border-left-color: var(--blue); }
.it.done, .it.answered { border-left-color: var(--accent-hover); }
.it.needs_decision { border-left-color: var(--warning-text); background: var(--warning-bg, var(--bg2)); }
.it.rejected { border-left-color: var(--border-strong); opacity: 0.8; }
.it.outdated { border-left-color: var(--warning-text); border-style: dashed; }
.it.picked { border-color: var(--blue); }
.it-head { display: flex; align-items: center; }
.it-check { flex-shrink: 0; margin: 0 0 0 8px; accent-color: var(--blue); cursor: pointer; }
.it-line { flex: 1; min-width: 0; display: flex; align-items: center; gap: 6px; width: 100%; padding: 3px 8px; font: inherit; text-align: left; color: var(--text); background: none; border: none; cursor: pointer; }
.it-dot { width: 7px; height: 7px; flex-shrink: 0; border-radius: 50%; background: currentColor; color: var(--text-faint); }
.it.sent .it-dot { color: var(--blue-hover); }
.it.done .it-dot, .it.answered .it-dot { color: var(--accent-hover); }
.it.needs_decision .it-dot { color: var(--warning-text); }
.it-kind { flex-shrink: 0; width: 12px; font-weight: 700; color: var(--text-muted); text-align: center; }
.it-loc { flex-shrink: 0; max-width: 45%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: monospace; font-size: 11px; color: var(--text-muted); }
.it-summary { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.it.open .it-summary { visibility: hidden; flex: 0; }
.it-status { flex-shrink: 0; margin-left: auto; font-size: 11px; color: var(--text-muted); }
.it.needs_decision .it-status { color: var(--warning-text); font-weight: 600; }
.it-body { padding: 2px 10px 8px; white-space: normal; }
.it-snippet { margin: 4px 0; padding: 4px 8px; max-height: 120px; overflow: auto; font-size: 11px; background: var(--bg); border-radius: var(--radius-sm); color: var(--text-muted); }
.it-note { margin: 4px 0; color: var(--warning-text); }
.it-refs { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; }
.it-ref { padding: 0 6px; font: inherit; font-size: 11px; color: var(--blue-hover); background: var(--bg); border: 1px solid var(--border-strong); border-radius: var(--radius-pill); cursor: pointer; }
.it-answer { margin-top: 6px; padding: 4px 8px; background: var(--bg); border-radius: var(--radius-sm); }
.it-answer-title { font-size: 11px; font-weight: 600; color: var(--text-muted); }
.it-actions { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
.it-actions:empty { display: none; }
</style>
