<template>
  <article
    :id="'analysis-' + section.id"
    class="card"
    :class="{ highlight, opened, expanded, editing: editing && !locked, movable: !locked && !editing }"
    :draggable="!locked && !editing"
    @dragstart="$event.dataTransfer?.setData('application/x-plangent-section', section.id)"
    @dragover.prevent
    @drop.prevent="drop"
  >
    <header class="card-head">
      <span v-if="!locked && !editing" class="grip" title="Перетащите, чтобы поменять порядок, или выберите в меню ⋯">⠿</span>
      <!-- The chevron is the control; the title beside it folds too. The body starts under the title's first letter. -->
      <AppButton variant="subtle" size="xs" icon :aria-expanded="expanded" :title="expanded ? 'Свернуть' : 'Развернуть'" :aria-label="(expanded ? 'Свернуть: ' : 'Развернуть: ') + section.title" @click="expanded = !expanded">
        <UIIconChevronRight class="chevron" :class="{ open: expanded }" />
      </AppButton>
      <span class="card-title" :title="section.title" @click="expanded = !expanded">{{ section.title }}</span>
      <span v-if="highlight" class="card-fresh">изменено агентом</span>
      <AppBadge class="author" :tone="section.author === 'agent' ? 'open' : 'neutral'" :title="section.author === 'agent' ? 'Раздел записал агент' : 'Раздел добавили вы'">{{ section.author === 'agent' ? '✦ агент' : 'вы' }}</AppBadge>
      <!-- Quiet until the card is hovered: editing at hand, the rest (moving, deleting) in ⋯. -->
      <div v-if="!locked && !editing" class="card-actions">
        <AppButton variant="subtle" size="xs" icon title="Редактировать" aria-label="Редактировать раздел" @click="startEdit(); editing = true; expanded = true">
          <svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M10.8 2.7l2.5 2.5M3 13l.6-3L10.3 3.3a1 1 0 011.4 0l1 1a1 1 0 010 1.4L6 12.4 3 13z" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" /></svg>
        </AppButton>
        <AppMenu :items="menu" size="xs" title="Ещё" />
      </div>
    </header>

    <form v-if="editing && !locked" class="card-edit" @submit.prevent="$emit('save', { title, description }, saved => { if (saved) cancelEdit() })">
      <StaleDraftNote v-if="conflict" @reload="showChanges" />
      <AppInput v-model="title"  placeholder="Заголовок" aria-label="Заголовок раздела" :disabled="locked" />
      <AppTextarea v-model="description" block mono placeholder="Описание в markdown" aria-label="Описание раздела" :disabled="locked" rows="8" />
      <div class="card-edit-foot">
        <AppButton type="button" variant="ghost" size="sm" @click="cancelEdit">Отмена</AppButton>
        <AppButton type="submit" variant="primary" size="sm" :disabled="locked || !title.trim() || conflict" :title="conflict ? 'Сначала выберите, чью версию оставить' : ''">Сохранить</AppButton>
      </div>
    </form>
    <template v-else-if="expanded">
      <MessageMarkdown v-if="section.description.trim()" class="card-body" :text="section.description" />
      <p v-else class="card-empty">Без описания</p>
    </template>
    <p v-else-if="section.description.trim()" class="card-preview" @click="expanded = true">{{ preview }}</p>

    <ul v-if="section.files.length" class="files">
      <li v-for="file in section.files" :key="file.id" class="file">
        <AppButton variant="link" size="sm" :title="'Открыть ' + file.name" @click="$emit('file', file)">
          <span
            class="file-icon"
            :class="file.mime.startsWith('image/') ? 'image' : file.mime === 'application/pdf' ? 'pdf' : /json|yaml|xml|text/.test(file.mime) ? 'text' : ''"
          >{{ (file.name.includes('.') ? file.name.slice(file.name.lastIndexOf('.') + 1) : 'file').slice(0, 4) }}</span>
          <span class="file-name">{{ file.name }}</span>
          <span class="file-size">{{ file.size < 1024 * 1024 ? Math.ceil(file.size / 1024) + ' КБ' : (file.size / 1024 / 1024).toFixed(1) + ' МБ' }}</span>
        </AppButton>
        <AppButton v-if="!locked" variant="subtle" size="xs" icon title="Удалить файл" :aria-label="'Удалить файл ' + file.name" @click="$emit('deleteFile', file)">
          <svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" /></svg>
        </AppButton>
      </li>
    </ul>

    <div
      v-if="!locked && (expanded || editing)"
      class="file-drop"
      tabindex="0"
      title="Можно вставить картинку из буфера: кликните сюда и нажмите Ctrl+V"
      @dragenter="($event.currentTarget as HTMLElement).classList.add('over')"
      @dragleave.self="($event.currentTarget as HTMLElement).classList.remove('over')"
      @dragover.prevent
      @drop.prevent.stop="($event.currentTarget as HTMLElement).classList.remove('over'); uploadDrop($event)"
      @paste="paste"
    >
      <svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M10.5 5.5L6.2 9.8a1.2 1.2 0 001.7 1.7l4.6-4.6a2.4 2.4 0 00-3.4-3.4L4.5 8.1a3.6 3.6 0 005.1 5.1l3.9-3.9" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" /></svg>
      <span>Перетащите файлы сюда, вставьте картинку или
        <label class="pick">выберите<AppInput type="file" multiple hidden @change="selectFiles" /></label>
      </span>
      <span class="limit">до 25 МБ</span>
    </div>
  </article>
</template>
<script setup lang="ts">
import AppBadge from '@shared/ui/AppBadge.vue'
import AppInput from '@shared/ui/AppInput.vue'
import AppTextarea from '@shared/ui/AppTextarea.vue'
import { IconChevronRight as UIIconChevronRight } from '@shared/ui/icons'
import { useDraft } from '@core/composables/useDraft'
import StaleDraftNote from '@shared/ui/StaleDraftNote.vue'
import { computed, ref, watch } from 'vue'
import type { AnalysisFile, AnalysisSection } from '@contracts'
import { MessageMarkdown } from '@features/agent-chat'
import AppButton from '@shared/ui/AppButton.vue'
import AppMenu from '@shared/ui/AppMenu.vue'
const props = defineProps<{ section: AnalysisSection; locked: boolean; highlight: boolean; opened: boolean; agentRevision: number }>()
const emit = defineEmits<{
  save: [data: { title: string; description: string }, finish: (saved: boolean) => void]
  remove: []
  move: [kind: AnalysisSection['kind']]
  reorder: [id: string]
  shift: [direction: number]
  upload: [files: File[]]
  file: [file: AnalysisFile]
  deleteFile: [file: AnalysisFile]
}>()
const sectionDraft = useDraft(() => `task:${props.section.task_id}:section:${props.section.id}`, () => ({ active: false, title: '', description: '', version: '' }))
const expanded = ref(sectionDraft.value.active)
const editing = computed({ get: () => sectionDraft.value.active, set: value => { sectionDraft.value.active = value } })
const title = computed({ get: () => sectionDraft.value.title, set: value => { sectionDraft.value.title = value } })
const description = computed({ get: () => sectionDraft.value.description, set: value => { sectionDraft.value.description = value } })
const conflict = computed(() => editing.value && sectionDraft.value.version !== JSON.stringify([props.section.title, props.section.description]))
const preview = computed(() => {
  const [first, ...rest] = props.section.description.trim().split('\n')
  const text = first.replace(/^[#>*\-\s]+/, '')
  return rest.some(line => line.trim()) ? `${text}…` : text
})
watch(() => props.opened, value => { if (value) expanded.value = true }, { immediate: true })
function showChanges() { title.value = props.section.title; description.value = props.section.description; sectionDraft.value.version = JSON.stringify([props.section.title, props.section.description]) }
function cancelEdit() { editing.value = false; title.value = ''; description.value = ''; sectionDraft.value.version = '' }
function startEdit() { if (!editing.value) showChanges() }
const menu = computed(() => [
  { label: props.section.kind === 'source' ? 'В проработанные' : 'В исходные', action: () => emit('move', props.section.kind === 'source' ? 'worked' : 'source') },
  { label: 'Переместить выше', action: () => emit('shift', -1) },
  { label: 'Переместить ниже', action: () => emit('shift', 1) },
  { separator: true },
  { label: 'Удалить раздел', hint: 'Вместе с файлами', danger: true, action: () => emit('remove') },
])
function drop(event: DragEvent) {
  if (props.locked || editing.value) return
  const id = event.dataTransfer?.getData('application/x-plangent-section')
  if (!id || id === props.section.id) return
  emit('reorder', id)
}
function uploadDrop(event: DragEvent) {
  if (event.dataTransfer?.types.includes('application/x-plangent-section')) { drop(event); return }
  if (!props.locked && event.dataTransfer?.files.length) emit('upload', Array.from(event.dataTransfer.files))
}
function selectFiles(event: Event) { const input = event.target as HTMLInputElement; emit('upload', Array.from(input.files ?? [])); input.value = '' }
function paste(event: ClipboardEvent) { const files = Array.from(event.clipboardData?.files ?? []); if (files.length) { event.preventDefault(); emit('upload', files) } }
</script>
<style scoped>
/* --indent: where the title starts — after the grip and the chevron button — so the body lines up under it. */
.card { --indent: calc(var(--size-xs) + 6px); display: flex; flex-direction: column; gap: 8px; padding: 8px 10px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--bg); transition: border-color var(--motion-modal), background var(--motion-modal), box-shadow var(--motion-slow); }
.card:hover { border-color: var(--border-strong); }
.card.movable { --indent: calc(12px + 6px + var(--size-xs) + 6px); }
.card.expanded { background: var(--bg2); padding-bottom: 12px; }
.card.editing { border-color: var(--blue); background: var(--bg2); box-shadow: 0 0 0 3px var(--blue-soft); }
.card.opened { border-color: var(--blue-hover); }
.card.highlight { border-color: var(--blue-hover); animation: fresh 1.8s ease-out 2; }
@keyframes fresh { 0% { box-shadow: 0 0 0 4px var(--blue-pulse); } 100% { box-shadow: 0 0 0 0 var(--blue-pulse-end); } }

.card-head { display: flex; align-items: center; gap: 6px; min-height: var(--size-xs); }
.grip { width: 12px; flex-shrink: 0; color: var(--text-faint); font-size: var(--fs-sm); line-height: 1; cursor: grab; user-select: none; opacity: 0; transition: opacity var(--motion-fast); }
.card:hover .grip, .card:focus-within .grip { opacity: 1; }
.card.movable:active { cursor: grabbing; }
.chevron { width: 14px; height: 14px; flex-shrink: 0; color: var(--text-muted); transition: transform var(--motion-modal); }
.chevron.open { transform: rotate(90deg); }
.card-title { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--fs-md); font-weight: 600; color: var(--text); cursor: pointer; }
.card-fresh { font-size: var(--fs-xs); color: var(--blue-hover); white-space: nowrap; }
.author { flex-shrink: 0; margin-left: auto; }
.card-actions { display: flex; align-items: center; gap: 2px; opacity: 0; transition: opacity var(--motion-fast); }
.card:hover .card-actions, .card:focus-within .card-actions { opacity: 1; }

.card-preview { padding-left: var(--indent); font-size: var(--fs-md); color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: pointer; }
.card-body { padding-left: var(--indent); font-size: var(--fs-md); }
.card-empty { padding-left: var(--indent); font-size: var(--fs-md); color: var(--text-faint); font-style: italic; }

.card-edit { display: flex; flex-direction: column; gap: 8px; }
.card-edit .control { width: 100%; }
.card-edit-foot { display: flex; justify-content: flex-end; gap: 8px; }
.conflict { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 8px 10px; border: 1px solid var(--warning); border-radius: var(--radius-sm); background: var(--warning-soft); color: var(--warning-text); font-size: var(--fs-sm); }
.conflict span { flex: 1; min-width: 180px; }
.conflict-actions { display: flex; gap: 6px; }

.files { list-style: none; display: flex; flex-wrap: wrap; gap: 6px; padding-left: var(--indent); }
.file { display: inline-flex; align-items: center; max-width: 100%; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--bg3); transition: border-color var(--motion-fast); }
.file:hover { border-color: var(--text-faint); }
.file-open { display: inline-flex; align-items: center; gap: 7px; min-width: 0; padding: 4px 8px 4px 5px; background: none; border: none; color: var(--text); font-family: inherit; font-size: var(--fs-sm); cursor: pointer; }
.file-open:focus-visible, .file-remove:focus-visible { outline: 2px solid var(--blue); outline-offset: -2px; border-radius: var(--radius-sm); }
.file-icon { flex-shrink: 0; min-width: 30px; padding: 2px 4px; border-radius: var(--radius-4); background: var(--bg-hover); color: var(--text-muted); font-size: var(--fs-xs); font-weight: 700; letter-spacing: 0.3px; text-align: center; text-transform: uppercase; line-height: 1.3; }
.file-icon.image { background: var(--blue-soft); color: var(--blue-hover); }
.file-icon.pdf { background: var(--danger-soft); color: var(--danger-hover); }
.file-icon.text { background: var(--accent-soft); color: var(--accent-hover); }
.file-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.file-size { flex-shrink: 0; font-size: var(--fs-xs); color: var(--text-faint); }
.file-remove { display: inline-flex; align-items: center; justify-content: center; width: 22px; align-self: stretch; padding: 0; background: none; border: none; border-left: 1px solid var(--border); color: var(--text-faint); cursor: pointer; border-radius: 0 var(--radius-sm) var(--radius-sm) 0; }
.file-remove svg { width: 12px; height: 12px; }
.file-remove:hover { color: var(--danger-hover); background: var(--danger-soft); }

.file-drop { display: flex; align-items: center; gap: 8px; margin-left: var(--indent); padding: 8px 12px; border: 1px dashed var(--border-strong); border-radius: var(--radius-sm); color: var(--text-faint); font-size: var(--fs-sm); transition: border-color var(--motion-fast), background var(--motion-fast), color var(--motion-fast); }
.file-drop svg { width: 14px; height: 14px; flex-shrink: 0; }
.file-drop > span:not(.limit) { flex: 1; }
.file-drop .limit { font-size: var(--fs-xs); white-space: nowrap; }
.file-drop:focus { outline: none; border-color: var(--blue); color: var(--text-muted); }
.file-drop.over { border-style: solid; border-color: var(--blue-hover); background: var(--blue-soft); color: var(--blue-hover); }
.file-drop.over * { pointer-events: none; }
.pick { position: relative; color: var(--blue-hover); cursor: pointer; }
.pick:hover { text-decoration: underline; }
.pick:has(input:focus-visible) { outline: 2px solid var(--blue); outline-offset: 1px; border-radius: var(--radius-3); }
</style>
