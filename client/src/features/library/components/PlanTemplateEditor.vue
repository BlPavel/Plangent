<template>
  <div class="plan-template-editor">
    <div class="editor-grid">
      <section class="editor-section">
        <div class="section-row">
          <div>
            <h3>Основное тело</h3>
            <p>Этот текст агент получает первым в режиме планирования. Можно оставить пустым — тогда агент получит только Протокол Plangent.</p>
          </div>
          <div class="actions">
            <button class="btn btn-primary btn-sm" :disabled="saving || !isDirty" @click="save">
              {{ saving ? 'Сохранение...' : 'Сохранить' }}
            </button>
            <button class="btn btn-ghost btn-sm" :disabled="saving || !isDirty" @click="cancel">Отмена</button>
          </div>
        </div>
        <textarea
          v-model="content"
          class="template-editor"
          spellcheck="false"
          :disabled="loading"
        />
      </section>

      <section class="editor-section">
        <div class="section-row">
          <div>
            <h3>Протокол Plangent</h3>
            <p>Этот блок добавляется к prompt из кода и не сохраняется в пользовательский шаблон.</p>
          </div>
        </div>
        <textarea class="template-editor protocol readonly" :value="defaults.lockedProtocol" spellcheck="false" readonly />
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { api } from '@core/api'
import { useAppStore } from '@core/stores/app'
import type { LibraryItem, LibraryScope } from '@core/models'

const props = defineProps<{
  scope: LibraryScope
  projectId?: string
}>()

const appStore = useAppStore()

const defaults = ref({ lockedProtocol: '' })
const item = ref<LibraryItem | null>(null)
const content = ref('')
const savedContent = ref('')
const loading = ref(false)
const saving = ref(false)

const isDirty = computed(() => content.value !== savedContent.value)

onMounted(load)
watch(() => [props.scope, props.projectId], load)

async function load() {
  loading.value = true
  try {
    defaults.value = await loadDefaults()
    const params = new URLSearchParams({ type: 'plan-template', scope: props.scope })
    if (props.scope === 'project' && props.projectId) params.set('projectId', props.projectId)
    const items = await api.get<LibraryItem[]>(`/library?${params.toString()}`)
    item.value = items[0] ?? null
    if (item.value) {
      const full = await api.get<LibraryItem>(`/library/${item.value.id}`)
      content.value = full.content ?? ''
      savedContent.value = content.value
    } else {
      content.value = ''
      savedContent.value = content.value
    }
  } catch (e: unknown) {
    appStore.toast(String(e), 'error')
  } finally {
    loading.value = false
  }
}

function cancel() {
  content.value = savedContent.value
}

async function save() {
  saving.value = true
  try {
    if (item.value) {
      item.value = await api.put<LibraryItem>(`/library/${item.value.id}`, {
        content: content.value,
        title: 'Шаблон плана',
        slug: item.value.slug,
        type: 'plan-template',
        scope: props.scope,
        project_id: props.scope === 'project' ? (props.projectId ?? null) : null,
      })
    } else {
      item.value = await api.post<LibraryItem>('/library', {
        type: 'plan-template',
        slug: 'default_plan',
        title: 'Шаблон плана',
        description: '',
        scope: props.scope,
        project_id: props.scope === 'project' ? (props.projectId ?? null) : null,
        content: content.value,
      })
    }
    savedContent.value = content.value
    appStore.toast('Шаблон сохранён', 'success')
  } catch (e: unknown) {
    appStore.toast(String(e), 'error')
  } finally {
    saving.value = false
  }
}

async function loadDefaults(): Promise<{ lockedProtocol: string }> {
  return api.get<{ lockedProtocol: string }>('/library/plan-template/defaults')
}
</script>

<style scoped>
.plan-template-editor {
  min-height: 0;
}

.editor-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 18px;
}

.editor-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.section-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

h3 {
  margin: 0 0 3px;
  font-size: 14px;
}

p {
  margin: 0;
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.45;
}

.actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

.template-editor {
  width: 100%;
  min-height: 280px;
  background: var(--bg3);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text);
  font-family: 'Cascadia Code', 'JetBrains Mono', monospace;
  font-size: 12px;
  line-height: 1.5;
  padding: 12px;
  resize: vertical;
}

.template-editor:focus {
  outline: none;
  border-color: var(--blue);
}

.template-editor.readonly {
  min-height: 220px;
  color: var(--text-muted);
}

.template-editor.protocol {
  min-height: 150px;
}
</style>
