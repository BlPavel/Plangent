<template>
  <form class="errand-line" @submit.prevent="submit">
    <div class="entry">
      <label for="errand-text">⚡ Поручить агенту:</label>
      <input id="errand-text" v-model="text" placeholder="Что нужно сделать?" required :disabled="busy" />
      <select v-model="agent" aria-label="Агент"><option v-for="a in agents.filter(a => a.active)" :key="a.id" :value="a.id">{{ a.name }}</option></select>
      <button :disabled="busy || !text.trim() || !agent">{{ busy ? 'Готовим рабочее место…' : 'Поручить' }}</button>
    </div>
    <details><summary>Ещё</summary>
      <div class="options">
        <FormField v-if="ordinary" v-model="base" label="Базовая ветка" placeholder="Из настроек проекта" />
        <FormField v-model="policy" label="Автономность" type="select"><option value="allow-all">Автономно</option><option value="allow-edits">Разрешать правки</option><option value="ask">Спрашивать</option></FormField>
        <FormField v-model="model" label="Модель" placeholder="По умолчанию" />
        <label><input v-model="review" type="checkbox" /> Ревью агентом</label>
        <label>Файл <input type="file" @change="file = ($event.target as HTMLInputElement).files?.[0]" /></label>
      </div>
    </details>
    <p v-if="error" role="alert">{{ error }}</p>
  </form>
</template>
<script setup lang="ts">
import { ref, watch } from 'vue'
import type { Agent, Task } from '@core/models'
import { api } from '@core/api'
import FormField from '@shared/ui/FormField.vue'
import { gitApi } from '@features/code'
const props = defineProps<{ projectId: string; defaultAgentId?: string | null; agents: Agent[]; ordinary: boolean }>()
const emit = defineEmits<{ created: [Task] }>()
const text = ref(''), agent = ref(props.defaultAgentId || ''), base = ref(''), model = ref(''), policy = ref('allow-all')
const review = ref(false), busy = ref(false), error = ref(''), file = ref<File>()
// «Ревью агентом» starts as the project's setting (off by default); a group has no such setting.
watch(() => props.projectId, async id => {
  try { const settings = await gitApi.settings(id); if (id === props.projectId) review.value = !!settings.auto_review } catch { /* keep off */ }
}, { immediate: true })
watch(() => props.defaultAgentId, value => { if (!agent.value) agent.value = value || '' })
async function submit() {
  if (busy.value) return
  busy.value = true; error.value = ''
  try {
    let request = text.value
    if (file.value) {
      const attachment = file.value
      const data = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(attachment) })
      const uploaded = await api.post<{ path: string }>('/upload-temp', { data, name: attachment.name })
      request += '\nПриложенный файл: ' + uploaded.path
    }
    const result = await api.post<{ task: Task }>('/projects/' + props.projectId + '/errands', { text: request, agent_id: agent.value, model: model.value, policy: policy.value, base_branch: base.value, auto_review: review.value })
    text.value = ''; file.value = undefined
    emit('created', result.task)
  } catch (cause) { error.value = String(cause) }
  finally { busy.value = false }
}
</script>
<style scoped>
.errand-line { padding: 12px 16px; border-bottom: 1px solid var(--border); }
.entry, .options { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.entry > input { flex: 1; min-width: 180px; }
input, select, button { padding: 7px; color: inherit; background: var(--bg); border: 1px solid var(--border); border-radius: 5px; }
details { margin-top: 8px; }
.options { margin-top: 10px; }
</style>
