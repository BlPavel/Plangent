<template>
  <span ref="root" class="fr" :class="{ inline }">
    <AppButton :variant="variant" size="xs" :disabled="busy || store.agentWorking" :title="store.agentWorking ? 'Агент работает: дождитесь конца ответа' : 'Зафиксировать конец ревью и убрать его в историю'" @click="start">{{ label }}</AppButton>
    <Transition name="fr-pop">
      <div v-if="choosing && !inline" class="fr-pop" role="group" aria-label="Что сделать с незакрытыми пунктами">
        <div class="fr-head">Не закрыто пунктов: <b>{{ unresolved }}</b></div>
        <button type="button" class="fr-opt" :disabled="busy" @click="run('carry')">
          <span class="fr-opt-label">Перенести в следующее ревью</span>
          <span class="fr-opt-hint">Станут черновиками следующего ревью этой ветки</span>
        </button>
        <button type="button" class="fr-opt" :disabled="busy" @click="run('close')">
          <span class="fr-opt-label">Закрыть их</span>
          <span class="fr-opt-hint">Будут отклонены, история сохранится</span>
        </button>
        <div class="fr-sep" />
        <button type="button" class="fr-link" @click="choosing = false; emit('open-items')">Открыть замечания</button>
      </div>
    </Transition>
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
import { useAppStore } from '@core/stores/app'
import { useCodeStore } from '../stores/code'

withDefaults(defineProps<{ label?: string; variant?: 'primary' | 'blue' | 'ghost' | 'subtle'; inline?: boolean }>(), { label: 'Завершить ревью', variant: 'ghost', inline: false })
const emit = defineEmits<{ 'open-items': [] }>()
const store = useCodeStore()
const app = useAppStore()
const choosing = ref(false)
const busy = ref(false)
const unresolved = computed(() => store.unresolved)
const root = ref<HTMLElement | null>(null)

function onDocClick(e: MouseEvent) {
  if (choosing.value && !root.value?.contains(e.target as Node)) choosing.value = false
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
.fr-text { font-size: 12px; color: var(--text-muted); }
.fr-pop { position: absolute; right: 0; top: calc(100% + 6px); z-index: 40; width: 270px; padding: 5px; background: var(--bg2); border: 1px solid var(--border-strong); border-radius: var(--radius); box-shadow: var(--shadow-md); }
.fr-head { padding: 6px 10px 4px; font-size: 12px; color: var(--text-muted); }
.fr-head b { color: var(--warning-text); font-weight: 600; }
.fr-opt { display: flex; flex-direction: column; gap: 2px; width: 100%; padding: 7px 10px; background: none; border: none; border-radius: var(--radius-sm); color: var(--text); font-size: 13px; font-family: inherit; text-align: left; cursor: pointer; }
.fr-opt:hover:not(:disabled) { background: var(--bg3); }
.fr-opt:disabled { color: var(--text-faint); cursor: default; }
.fr-opt-hint { font-size: 11.5px; color: var(--text-faint); line-height: 1.35; }
.fr-sep { height: 1px; margin: 4px 2px; background: var(--border); }
.fr-link { width: 100%; padding: 6px 10px; background: none; border: none; border-radius: var(--radius-sm); color: var(--blue-hover); font-size: 12.5px; font-family: inherit; text-align: left; cursor: pointer; }
.fr-link:hover { background: var(--blue-soft); }
.fr-pop-enter-active, .fr-pop-leave-active { transition: opacity 0.12s, transform 0.12s; }
.fr-pop-enter-from, .fr-pop-leave-to { opacity: 0; transform: translateY(-4px); }
</style>
