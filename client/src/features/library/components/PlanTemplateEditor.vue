<template>
  <div class="plan-template-editor" :class="{ 'material-template': type !== 'plan-template' }">
    <div class="editor-grid">
      <section class="editor-section">
        <div class="section-row">
          <div>
            <h3>Основное тело</h3>
            <p>{{ type === 'plan-template' ? 'Текст для планирования. Можно оставить пустым.' : 'Как писать материал. Если своё не задано, применяется встроенный текст.' }}</p>
          </div>
          <div class="actions">
            <AppButton variant="primary" size="sm" :disabled="saving || !isDirty" @click="save">
              {{ saving ? 'Сохранение...' : 'Сохранить' }}
            </AppButton>
            <AppButton variant="ghost" size="sm" :disabled="saving || !isDirty" @click="cancel">Отмена</AppButton>
            <AppButton v-if="type !== 'plan-template' && item" variant="ghost" size="sm" :disabled="saving" @click="reset">Вернуть предустановленное</AppButton>
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
            <p>Plangent добавляет этот блок к инструкции автоматически. Он не сохраняется в пользовательский шаблон.</p>
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
import AppButton from '@shared/ui/AppButton.vue'
import type { LibraryItem, LibraryScope } from '@core/models'

const props = withDefaults(defineProps<{
  scope: LibraryScope
  projectId?: string
  type?: 'plan-template' | 'architecture-template' | 'qa-template'
}>(), { type: 'plan-template' })

const appStore = useAppStore()

const defaults = ref({ lockedProtocol: '', content: '' })
const title = computed(() => ({ 'plan-template': 'Шаблон плана', 'architecture-template': 'Как писать архитектуру', 'qa-template': 'Как писать QA' })[props.type])
const item = ref<LibraryItem | null>(null)
const content = ref('')
const savedContent = ref('')
const loading = ref(false)
const saving = ref(false)

const isDirty = computed(() => content.value !== savedContent.value)

onMounted(load)
watch(() => [props.scope, props.projectId, props.type], load)

async function load() {
  loading.value = true
  try {
    defaults.value = await loadDefaults()
    const params = new URLSearchParams({ type: props.type, scope: props.scope })
    if (props.scope === 'project' && props.projectId) params.set('projectId', props.projectId)
    const items = await api.get<LibraryItem[]>(`/library?${params.toString()}`)
    item.value = items[0] ?? null
    if (item.value) {
      const full = await api.get<LibraryItem>(`/library/${item.value.id}`)
      content.value = full.content ?? ''
      savedContent.value = content.value
    } else {
      content.value = defaults.value.content ?? ''
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
        title: title.value,
        slug: item.value.slug,
        type: props.type,
        scope: props.scope,
        project_id: props.scope === 'project' ? (props.projectId ?? null) : null,
      })
    } else {
      item.value = await api.post<LibraryItem>('/library', {
        type: props.type,
        slug: props.type.replaceAll('-', '_'),
        title: title.value,
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

async function reset() {
  if (!item.value) return
  saving.value = true
  try { await api.delete(`/library/${item.value.id}`); await load() }
  catch (e) { appStore.toast(String(e), 'error') }
  finally { saving.value = false }
}
async function loadDefaults(): Promise<{ lockedProtocol: string; content: string }> {
  return api.get(`/library/${props.type}/defaults`)
}
</script>

<style scoped>
.plan-template-editor {
  display: flex;
  flex: 1;
  min-height: 0;
}

.material-template { flex: 0 0 480px; min-height: 480px; }

.editor-grid {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  grid-template-rows: minmax(0, 2fr) minmax(0, 1fr);
  gap: 18px;
}

.editor-section {
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.section-row {
  flex-shrink: 0;
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
  flex: 1;
  min-height: 0;
  background: var(--bg3);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text);
  font-family: 'Cascadia Code', 'JetBrains Mono', monospace;
  font-size: 12px;
  line-height: 1.5;
  padding: 12px;
  resize: none;
}

.template-editor:focus {
  outline: none;
  border-color: var(--blue);
}

.template-editor.readonly {
  color: var(--text-muted);
}
</style>
