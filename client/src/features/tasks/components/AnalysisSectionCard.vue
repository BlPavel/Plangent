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
      <button type="button" class="card-toggle" :aria-expanded="expanded" :title="expanded ? 'Свернуть' : 'Развернуть'" @click="expanded = !expanded">
        <svg class="chevron" :class="{ open: expanded }" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M6 4l4 4-4 4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" /></svg>
        <span class="card-title">{{ section.title }}</span>
      </button>
      <span v-if="highlight" class="card-fresh">изменено агентом</span>
      <span class="status-badge plain author" :class="section.author === 'agent' ? 'open' : 'neutral'" :title="section.author === 'agent' ? 'Раздел записал агент' : 'Раздел добавили вы'">{{ section.author === 'agent' ? '✦ агент' : 'ты' }}</span>
      <div v-if="!locked && !editing" class="card-actions">
        <AppButton variant="subtle" size="xs" icon title="Редактировать" aria-label="Редактировать раздел" @click="showChanges(); editing = true; expanded = true">
          <svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M10.8 2.7l2.5 2.5M3 13l.6-3L10.3 3.3a1 1 0 011.4 0l1 1a1 1 0 010 1.4L6 12.4 3 13z" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" /></svg>
        </AppButton>
        <AppButton class="remove" variant="subtle" size="xs" icon title="Удалить раздел" aria-label="Удалить раздел" @click="$emit('remove')">
          <svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M2.5 4h11M6 4V2.8c0-.4.3-.8.8-.8h2.4c.5 0 .8.4.8.8V4m2 0l-.5 8.4c0 .5-.4.9-.9.9H4.9c-.5 0-.9-.4-.9-.9L3.5 4M6.5 7v4M9.5 7v4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" /></svg>
        </AppButton>
        <AppMenu :items="menu" size="xs" />
      </div>
    </header>

    <form v-if="editing && !locked" class="card-edit" @submit.prevent="$emit('save', { title, description }, saved => { if (saved) editing = false })">
      <div v-if="conflict" class="conflict" role="alert">
        <span>Агент изменил этот раздел, пока вы его редактировали.</span>
        <div class="conflict-actions">
          <AppButton type="button" variant="blue" size="xs" @click="showChanges">Показать изменения</AppButton>
          <AppButton type="button" variant="ghost" size="xs" @click="conflict = false">Оставить моё</AppButton>
        </div>
      </div>
      <input v-model="title" class="control" placeholder="Заголовок" aria-label="Заголовок раздела" :disabled="locked">
      <textarea v-model="description" class="control editor" placeholder="Описание в markdown" aria-label="Описание раздела" :disabled="locked" rows="8" />
      <div class="card-edit-foot">
        <AppButton type="button" variant="ghost" size="sm" @click="editing = false">Отмена</AppButton>
        <AppButton type="submit" variant="primary" size="sm" :disabled="locked || !title.trim() || conflict" :title="conflict ? 'Сначала выберите, чью версию оставить' : ''">Сохранить</AppButton>
      </div>
    </form>
    <template v-else-if="expanded">
      <MessageMarkdown v-if="section.description.trim()" class="card-body" :text="section.description" />
      <p v-else class="card-empty">Без описания</p>
    </template>
    <p v-else-if="section.description.trim()" class="card-preview" @click="expanded = true">{{ section.description.trim().split('\n')[0].replace(/^[#>*\-\s]+/, '') }}</p>

    <ul v-if="section.files.length" class="files">
      <li v-for="file in section.files" :key="file.id" class="file">
        <button type="button" class="file-open" :title="'Открыть ' + file.name" @click="$emit('file', file)">
          <span
            class="file-icon"
            :class="file.mime.startsWith('image/') ? 'image' : file.mime === 'application/pdf' ? 'pdf' : /json|yaml|xml|text/.test(file.mime) ? 'text' : ''"
          >{{ (file.name.includes('.') ? file.name.slice(file.name.lastIndexOf('.') + 1) : 'file').slice(0, 4) }}</span>
          <span class="file-name">{{ file.name }}</span>
          <span class="file-size">{{ file.size < 1024 * 1024 ? Math.ceil(file.size / 1024) + ' КБ' : (file.size / 1024 / 1024).toFixed(1) + ' МБ' }}</span>
        </button>
        <button v-if="!locked" type="button" class="file-remove" title="Удалить файл" :aria-label="'Удалить файл ' + file.name" @click="$emit('deleteFile', file)">
          <svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" /></svg>
        </button>
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
        <label class="pick">выберите<input type="file" multiple @change="selectFiles"></label>
      </span>
      <span class="limit">до 25 МБ</span>
    </div>
  </article>
</template>
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { AnalysisFile, AnalysisSection } from '@core/models'
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
const expanded = ref(false), editing = ref(false), conflict = ref(false)
const title = ref(''), description = ref('')
watch(() => props.opened, value => { if (value) expanded.value = true }, { immediate: true })
watch(() => props.section, (next, old) => {
  if (editing.value && (next.description !== old.description || next.title !== old.title)) conflict.value = true
})
function showChanges() { title.value = props.section.title; description.value = props.section.description; conflict.value = false }
const menu = computed(() => [
  { label: 'Редактировать', action: () => { showChanges(); editing.value = true; expanded.value = true } },
  { label: props.section.kind === 'source' ? 'В проработанные' : 'В исходные', action: () => emit('move', props.section.kind === 'source' ? 'worked' : 'source') },
  { label: 'Переместить выше', action: () => emit('shift', -1) },
  { label: 'Переместить ниже', action: () => emit('shift', 1) },
  { label: 'Удалить раздел', danger: true, action: () => emit('remove') },
])
function drop(event: DragEvent) { const id = event.dataTransfer?.getData('application/x-plangent-section'); if (id) emit('reorder', id) }
function uploadDrop(event: DragEvent) { if (event.dataTransfer?.files.length) emit('upload', Array.from(event.dataTransfer.files)) }
function selectFiles(event: Event) { const input = event.target as HTMLInputElement; emit('upload', Array.from(input.files ?? [])); input.value = '' }
function paste(event: ClipboardEvent) { const files = Array.from(event.clipboardData?.files ?? []); if (files.length) { event.preventDefault(); emit('upload', files) } }
</script>
<style scoped>
.card { --indent: 20px; display: flex; flex-direction: column; gap: 8px; padding: 8px 10px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--bg); transition: border-color 0.15s, background 0.15s, box-shadow 0.3s; }
.card:hover { border-color: var(--border-strong); }
.card.movable { --indent: 38px; }
.card.expanded { background: var(--bg2); padding-bottom: 12px; }
.card.editing { border-color: var(--blue); background: var(--bg2); box-shadow: 0 0 0 3px var(--blue-soft); }
.card.opened { border-color: var(--blue-hover); }
.card.highlight { border-color: var(--blue-hover); animation: fresh 1.8s ease-out 2; }
@keyframes fresh { 0% { box-shadow: 0 0 0 4px rgba(56, 139, 253, 0.35); } 100% { box-shadow: 0 0 0 0 rgba(56, 139, 253, 0); } }

.card-head { display: flex; align-items: center; gap: 6px; min-height: var(--size-xs); }
.grip { width: 12px; flex-shrink: 0; color: var(--text-faint); font-size: 12px; line-height: 1; cursor: grab; user-select: none; opacity: 0; transition: opacity 0.12s; }
.card:hover .grip, .card:focus-within .grip { opacity: 1; }
.card.movable:active { cursor: grabbing; }
.card-toggle { display: flex; align-items: center; gap: 6px; flex: 1; min-width: 0; padding: 2px 4px 2px 0; background: none; border: none; color: var(--text); font-family: inherit; font-size: 13px; font-weight: 600; text-align: left; cursor: pointer; }
.card-toggle:focus-visible { outline: 2px solid var(--blue); outline-offset: 1px; border-radius: 4px; }
.chevron { width: 14px; height: 14px; flex-shrink: 0; color: var(--text-muted); transition: transform 0.15s; }
.chevron.open { transform: rotate(90deg); }
.card-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.card-fresh { font-size: 11px; color: var(--blue-hover); white-space: nowrap; }
.author { height: 20px; padding: 0 8px; font-weight: 500; flex-shrink: 0; }
.card-actions { display: flex; align-items: center; gap: 2px; opacity: 0.55; transition: opacity 0.12s; }
.card:hover .card-actions, .card:focus-within .card-actions { opacity: 1; }
.card-actions .remove:not(:disabled):hover { color: var(--danger-hover); background: var(--danger-soft); }

.card-preview { padding-left: var(--indent); font-size: 12.5px; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: pointer; }
.card-body { padding-left: var(--indent); font-size: 13px; }
.card-body :deep(button.btn[data-analysis-target]) { height: 19px; margin: 0 1px; padding: 0 6px; vertical-align: 1px; border: 1px solid var(--blue-soft); border-radius: 5px; background: var(--blue-soft); color: var(--blue-hover); font-family: 'Cascadia Code', 'JetBrains Mono', monospace; font-size: 11.5px; font-weight: 400; }
.card-body :deep(button.btn[data-analysis-target]:disabled) { opacity: 1; border-style: dashed; border-color: var(--danger); background: var(--danger-soft); color: var(--danger-hover) !important; text-decoration: line-through; }
.card-empty { padding-left: var(--indent); font-size: 12.5px; color: var(--text-faint); font-style: italic; }

.card-edit { display: flex; flex-direction: column; gap: 8px; }
.card-edit .control { width: 100%; }
.card-edit .editor { height: auto; min-height: 140px; padding: 8px 12px; line-height: 1.5; resize: vertical; font-family: 'Cascadia Code', 'JetBrains Mono', monospace; font-size: 12.5px; }
.card-edit-foot { display: flex; justify-content: flex-end; gap: 8px; }
.conflict { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 8px 10px; border: 1px solid var(--warning); border-radius: var(--radius-sm); background: var(--warning-soft); color: var(--warning-text); font-size: 12px; }
.conflict span { flex: 1; min-width: 180px; }
.conflict-actions { display: flex; gap: 6px; }

.files { list-style: none; display: flex; flex-wrap: wrap; gap: 6px; padding-left: var(--indent); }
.file { display: inline-flex; align-items: center; max-width: 100%; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--bg3); transition: border-color 0.12s; }
.file:hover { border-color: var(--text-faint); }
.file-open { display: inline-flex; align-items: center; gap: 7px; min-width: 0; padding: 4px 8px 4px 5px; background: none; border: none; color: var(--text); font-family: inherit; font-size: 12px; cursor: pointer; }
.file-open:focus-visible, .file-remove:focus-visible { outline: 2px solid var(--blue); outline-offset: -2px; border-radius: var(--radius-sm); }
.file-icon { flex-shrink: 0; min-width: 30px; padding: 2px 4px; border-radius: 4px; background: var(--bg-hover); color: var(--text-muted); font-size: 9px; font-weight: 700; letter-spacing: 0.3px; text-align: center; text-transform: uppercase; line-height: 1.3; }
.file-icon.image { background: var(--blue-soft); color: var(--blue-hover); }
.file-icon.pdf { background: var(--danger-soft); color: var(--danger-hover); }
.file-icon.text { background: var(--accent-soft); color: var(--accent-hover); }
.file-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.file-size { flex-shrink: 0; font-size: 11px; color: var(--text-faint); }
.file-remove { display: inline-flex; align-items: center; justify-content: center; width: 22px; align-self: stretch; padding: 0; background: none; border: none; border-left: 1px solid var(--border); color: var(--text-faint); cursor: pointer; border-radius: 0 var(--radius-sm) var(--radius-sm) 0; }
.file-remove svg { width: 12px; height: 12px; }
.file-remove:hover { color: var(--danger-hover); background: var(--danger-soft); }

.file-drop { display: flex; align-items: center; gap: 8px; margin-left: var(--indent); padding: 8px 12px; border: 1px dashed var(--border-strong); border-radius: var(--radius-sm); color: var(--text-faint); font-size: 12px; transition: border-color 0.12s, background 0.12s, color 0.12s; }
.file-drop svg { width: 14px; height: 14px; flex-shrink: 0; }
.file-drop > span:not(.limit) { flex: 1; }
.file-drop .limit { font-size: 11px; white-space: nowrap; }
.file-drop:focus { outline: none; border-color: var(--blue); color: var(--text-muted); }
.file-drop.over { border-style: solid; border-color: var(--blue-hover); background: var(--blue-soft); color: var(--blue-hover); }
.file-drop.over * { pointer-events: none; }
.pick { position: relative; color: var(--blue-hover); cursor: pointer; }
.pick:hover { text-decoration: underline; }
.pick input { position: absolute; width: 1px; height: 1px; opacity: 0; overflow: hidden; }
.pick:has(input:focus-visible) { outline: 2px solid var(--blue); outline-offset: 1px; border-radius: 3px; }
</style>
