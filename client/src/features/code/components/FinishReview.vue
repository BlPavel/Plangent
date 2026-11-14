<template>
  <span ref="root" class="fr" :class="{ inline }">
    <AppButton :variant="variant" size="xs" :disabled="busy || store.agentWorking || empty" :title="store.agentWorking ? 'Агент работает: дождитесь конца ответа' : empty ? 'В ревью пока нет замечаний: завершать нечего' : 'Зафиксировать конец ревью и убрать его в историю'" @click="start">{{ label }}</AppButton>
    <AppPopover :model-value="choosing && !inline" :anchor="root" role="group" label="Что сделать с незакрытыми пунктами" @update:model-value="choosing = $event">
        <div class="fr-head">Не закрыто пунктов: <b>{{ unresolved }}</b></div>
        <AppButton variant="ghost" size="sm" block :disabled="busy" title="Станут черновиками следующего ревью этой ветки" @click="run('carry')">Перенести в следующее ревью</AppButton>
        <span class="fr-opt-hint">Станут черновиками следующего ревью этой ветки</span>
        <AppButton variant="ghost" size="sm" block :disabled="busy" title="Будут отклонены, история сохранится" @click="run('close')">Закрыть их</AppButton>
        <span class="fr-opt-hint">Будут отклонены, история сохранится</span>
        <div class="fr-sep" />
        <AppButton variant="link" size="xs" type="button" @click="choosing = false; emit('open-items')">Открыть замечания</AppButton>
    </AppPopover>
    <span v-if="choosing && inline" class="fr-choice" role="group" aria-label="Что сделать с незакрытыми пунктами">
      <span class="fr-text">Не закрыто пунктов: {{ unresolved }}</span>
      <AppButton variant="blue" size="xs" :disabled="busy" title="Незакрытые пункты станут черновиками следующего ревью этой ветки" @click="run('carry')">Завершить и перенести в следующее ревью</AppButton>
      <AppButton variant="ghost" size="xs" :disabled="busy" title="Незакрытые пункты будут отклонены, история сохранится" @click="run('close')">Завершить и закрыть их</AppButton>
      <AppButton variant="subtle" size="xs" @click="choosing = false; emit('open-items')">Открыть замечания</AppButton>
    </span>
  </span>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import AppButton from '@shared/ui/AppButton.vue'
import AppPopover from '@shared/ui/AppPopover.vue'
import { useAppStore } from '@core/stores/app'
import { useCodeStore } from '../stores/code'

const props = withDefaults(defineProps<{ label?: string; variant?: 'primary' | 'blue' | 'ghost' | 'subtle'; inline?: boolean }>(), { label: 'Завершить ревью', variant: 'ghost', inline: false })
const emit = defineEmits<{ 'open-items': [] }>()
const store = useCodeStore()
const app = useAppStore()
const choosing = ref(false)
const busy = ref(false)
const unresolved = computed(() => store.unresolved)
/** A review without a single item has nothing to finish. */
const empty = computed(() => !store.items.length)
const root = ref<HTMLElement | null>(null)

function onDocClick(e: MouseEvent) {
  if (props.inline && choosing.value && !root.value?.contains(e.target as Node)) choosing.value = false
}
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') choosing.value = false
}
onMounted(() => {
  document.addEventListener('mousedown', onDocClick)
  document.addEventListener('keydown', onKey)
})
onUnmounted(() => {
  document.removeEventListener('mousedown', onDocClick)
  document.removeEventListener('keydown', onKey)
})

async function run(mode: 'require_resolved' | 'carry' | 'close') {
  const review = store.liveReview
  if (!review) return
  busy.value = true
  try {
    await store.finish(review.id, mode)
    choosing.value = false
    app.toast(mode === 'carry' ? `Ревью #${review.number} завершено, незакрытые пункты перенесены в черновики` : `Ревью #${review.number} завершено`, 'success')
  } catch (cause) { app.toast(cause instanceof Error ? cause.message : 'Не удалось завершить ревью', 'error') }
  finally { busy.value = false }
}
async function start() {
  if (choosing.value) { choosing.value = false; return }
  if (unresolved.value) { choosing.value = true; return }
  const review = store.liveReview
  if (review && await app.confirm(`Завершить ревью #${review.number}? Оно уйдёт в историю.`, { confirmLabel: 'Завершить' })) await run('require_resolved')
}
</script>

<style scoped>
.fr { position: relative; display: inline-flex; align-items: center; gap: 6px; }
.fr.inline { flex-wrap: wrap; }
.fr-choice { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.fr-text { font-size: var(--fs-sm); color: var(--text-muted); }
.fr-pop { position: absolute; right: 0; top: calc(100% + 6px); z-index: var(--z-suggestions); width: 270px; padding: 5px; background: var(--bg2); border: 1px solid var(--border-strong); border-radius: var(--radius); box-shadow: var(--shadow-md); }
.fr-head { padding: 6px 10px 6px; font-size: var(--fs-sm); color: var(--text-muted); }
.fr-head b { color: var(--warning-text); font-weight: 600; }
/* The two actions are bordered buttons; their hints stay quiet text under them. */
.fr-opt-hint { display: block; margin: 4px 2px 10px; padding: 0 8px; font-size: var(--fs-sm); color: var(--text-faint); line-height: 1.35; }
.fr-sep { height: 1px; margin: 4px 2px; background: var(--border); }
.fr-pop-enter-active, .fr-pop-leave-active { transition: opacity var(--motion-fast), transform var(--motion-fast); }
.fr-pop-enter-from, .fr-pop-leave-to { opacity: 0; transform: translateY(-4px); }
</style>
