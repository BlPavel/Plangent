<template>
  <span class="fr" :class="{ inline }">
    <AppButton :variant="variant" size="xs" :disabled="busy || store.agentWorking" :title="store.agentWorking ? 'Агент работает: дождитесь конца ответа' : 'Зафиксировать конец ревью и убрать его в историю'" @click="start">{{ label }}</AppButton>
    <span v-if="choosing" class="fr-choice" :class="{ floating: !inline }" role="group" aria-label="Что сделать с незакрытыми пунктами">
      <span class="fr-text">Не закрыто пунктов: {{ unresolved }}</span>
      <AppButton variant="blue" size="xs" :disabled="busy" title="Незакрытые пункты станут черновиками следующего ревью этой ветки" @click="run('carry')">Завершить и перенести в следующее ревью</AppButton>
      <AppButton variant="ghost" size="xs" :disabled="busy" title="Незакрытые пункты будут отклонены, история сохранится" @click="run('close')">Завершить и закрыть их</AppButton>
      <AppButton variant="subtle" size="xs" @click="choosing = false; emit('open-items')">Открыть замечания</AppButton>
    </span>
  </span>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
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
.fr-choice.floating { position: absolute; right: 0; top: calc(100% + 4px); z-index: 40; flex-direction: column; align-items: stretch; width: 260px; padding: 8px; background: var(--bg2); border: 1px solid var(--border-strong); border-radius: var(--radius); box-shadow: var(--shadow-md); }
.fr-text { font-size: 12px; color: var(--text-muted); }
</style>
