<template>
  <div class="guide-editor">
    <div class="section-row">
      <div>
        <h3>Руководство по инструкциям</h3>
        <p>По нему агент-библиотекарь решает, куда записать знание (скилл, главный файл, команда) и как оформить текст. Действует ближайший уровень: проект, группа, глобальное; если нигде не задано — предустановленное.</p>
      </div>
    </div>

    <div class="effective">
      <span class="effective-label">Сейчас действует:</span>
      <span class="effective-value" :class="{ own: effective === 'own' }">{{ effectiveLabel }}</span>
    </div>

    <template v-if="editing">
      <div class="toolbar">
        <AppButton size="sm" variant="ghost" :disabled="saving" @click="useDefault">Взять предустановленное за основу</AppButton>
        <AppButton v-if="inherited" size="sm" variant="ghost" :disabled="saving" @click="content = inherited.content">Взять {{ inherited.label }} за основу</AppButton>
        <span class="spacer" />
        <AppButton size="sm" variant="primary" :disabled="saving || !isDirty || !content.trim()" @click="save">{{ saving ? 'Сохранение…' : 'Сохранить' }}</AppButton>
        <AppButton size="sm" variant="ghost" :disabled="saving" @click="cancel">{{ own ? 'Отмена' : 'Не переопределять' }}</AppButton>
        <AppButton v-if="own" size="sm" variant="danger-ghost" :disabled="saving" @click="reset">{{ scope === 'global' ? 'Вернуть предустановленное' : 'Сбросить переопределение' }}</AppButton>
      </div>
      <textarea v-model="content" class="text" spellcheck="false" :disabled="loading" placeholder="Текст руководства (Markdown, лучше на английском — так же, как пишутся сами инструкции)" />
    </template>

    <template v-else>
      <div class="toolbar">
        <AppButton size="sm" variant="primary" :disabled="loading" @click="startOverride(inherited?.content ?? defaultText)">
          {{ scope === 'global' ? 'Задать своё руководство' : `Переопределить для ${levelName}` }}
        </AppButton>
        <span class="hint">Начнётся с текста, который действует сейчас.</span>
      </div>
      <textarea v-if="inherited" class="text readonly" :value="inherited.content" spellcheck="false" readonly />
    </template>

    <section class="defaults">
      <h3>Предустановленные инструкции</h3>
      <p>Встроенное руководство, которое применяется, если своё не задано. Его можно взять за основу с помощью кнопки в редакторе.</p>
      <textarea class="text readonly" :value="defaultText" aria-label="Предустановленные инструкции" spellcheck="false" readonly />
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { api } from '@core/api'
import { useAppStore } from '@core/stores/app'
import { useProjectsStore } from '@features/projects'
import type { LibraryItem, LibraryScope } from '@core/models'
import AppButton from '@shared/ui/AppButton.vue'
import { useLibraryStore } from '../stores/library'

const props = defineProps<{ scope: LibraryScope; projectId?: string }>()
const app = useAppStore(), store = useLibraryStore(), projects = useProjectsStore()

const own = ref<LibraryItem | null>(null)
const inherited = ref<{ origin: 'group' | 'global'; label: string; content: string } | null>(null)
const defaultText = ref('')
const content = ref(''), saved = ref('')
const editing = ref(false), loading = ref(false), saving = ref(false)
const isDirty = computed(() => content.value !== saved.value)

const project = computed(() => props.scope === 'project' ? projects.byId(props.projectId) : null)
const levelName = computed(() => project.value?.kind === 'group' ? 'группы' : 'проекта')
const effective = computed(() => own.value ? 'own' : inherited.value?.origin ?? 'default')
const effectiveLabel = computed(() => {
  if (effective.value === 'own') return props.scope === 'global' ? 'глобальное (своё)' : `своё для ${levelName.value}`
  if (effective.value === 'group') return `от группы «${projects.byId(project.value?.group_id)?.name ?? '—'}»`
  if (effective.value === 'global') return 'глобальное, из настроек'
  return 'предустановленное'
})

onMounted(load)
watch(() => [props.scope, props.projectId], load)

// The project list carries each item's origin; the nearest enabled level wins, as on the server.
async function load() {
  loading.value = true
  try {
    defaultText.value = await store.getInstructionGuideDefault()
    const list = props.scope === 'global'
      ? (await api.get<LibraryItem[]>('/library?type=instruction-guide&scope=global')).map(i => ({ ...i, origin: 'direct' as const }))
      : await api.get<LibraryItem[]>(`/library?type=instruction-guide&forProject=${encodeURIComponent(props.projectId ?? '')}`)
    own.value = list.find(i => i.origin === 'direct') ?? null
    const parent = (['group', 'global'] as const).map(origin => list.find(i => i.origin === origin && i.enabled)).find(Boolean)
    inherited.value = parent
      ? { origin: parent.origin as 'group' | 'global', label: parent.origin === 'group' ? 'руководство группы' : 'глобальное', content: (await store.getItem(parent.id)).content ?? '' }
      : null
    saved.value = own.value ? (await store.getItem(own.value.id)).content ?? '' : ''
    content.value = saved.value
    editing.value = !!own.value
  } catch (e) { app.toast(String(e), 'error') }
  finally { loading.value = false }
}

function startOverride(text: string) { content.value = text; editing.value = true }
function useDefault() { content.value = defaultText.value }
function cancel() {
  content.value = saved.value
  if (!own.value) editing.value = false
}

async function save() {
  saving.value = true
  try {
    if (own.value) await api.put<LibraryItem>(`/library/${own.value.id}`, { content: content.value })
    else own.value = await api.post<LibraryItem>('/library', {
      type: 'instruction-guide', slug: 'instruction_guide', title: 'Руководство по инструкциям', description: '',
      scope: props.scope, targets: props.scope === 'project' && props.projectId ? [props.projectId] : [], content: content.value,
    })
    saved.value = content.value
    app.toast('Руководство сохранено', 'success')
  } catch (e) { app.toast(String(e), 'error') }
  finally { saving.value = false }
}

async function reset() {
  if (!own.value) return
  const next = props.scope === 'global' ? 'предустановленное' : inherited.value ? inherited.value.label : 'предустановленное'
  if (!(await app.confirm(`Удалить своё руководство? Будет действовать ${next}.`))) return
  try { await store.remove(own.value.id); await load() }
  catch (e) { app.toast(String(e), 'error') }
}
</script>

<style scoped>
.guide-editor { display: flex; flex-direction: column; gap: 10px; min-height: 0; }
.defaults { display: flex; flex-direction: column; gap: 6px; margin-top: 6px; }
.section-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
h3 { margin: 0 0 3px; font-size: 14px; }
p { margin: 0; color: var(--text-muted); font-size: 12px; line-height: 1.45; max-width: 720px; }
.effective { font-size: 12.5px; display: flex; gap: 6px; }
.effective-label { color: var(--text-muted); }
.effective-value { font-weight: 500; }
.effective-value.own { color: var(--blue-hover); }
.toolbar { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.spacer { flex: 1; }
.hint { font-size: 12px; color: var(--text-faint); }
.text {
  width: 100%; min-height: 360px; background: var(--bg3); border: 1px solid var(--border); border-radius: var(--radius);
  color: var(--text); font-family: 'Cascadia Code', 'JetBrains Mono', monospace; font-size: 12px; line-height: 1.5; padding: 12px; resize: vertical;
}
.text:focus { outline: none; border-color: var(--blue); }
.text.readonly { color: var(--text-muted); }
</style>
