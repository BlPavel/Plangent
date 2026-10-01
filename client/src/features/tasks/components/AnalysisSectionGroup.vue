<template>
  <section class="analysis-group" :class="kind">
    <header class="group-head">
      <span class="group-name"><span class="group-dot" />{{ kind === 'source' ? 'Исходные' : 'Проработанные' }}</span>
      <span v-if="sections.length" class="group-count">{{ sections.length }}</span>
      <span class="group-hint">{{ kind === 'source' ? 'ТЗ, API, условия, макеты, переписка' : 'выводы, отчёты, решения' }}</span>
    </header>
    <div v-if="!sections.length" class="group-empty">
      {{ kind === 'source' ? 'Исходных материалов нет' : 'Проработанных разделов пока нет' }}{{ locked || kind === 'source' ? '' : ' — агент добавит их из чата' }}
    </div>
    <AnalysisSectionCard
      v-for="section in sections" :key="section.id" :section="section" :locked="locked" :highlight="highlights.includes(section.id)" :opened="opened === section.id" :agent-revision="agentRevision"
      @save="(data, finish) => $emit('save', section, data, finish)" @remove="$emit('remove', section)" @move="$emit('move', section, $event)"
      @reorder="$emit('reorder', $event, section.id)" @shift="$emit('shift', section, $event)" @upload="$emit('upload', section, $event)" @file="$emit('file', section, $event)" @delete-file="$emit('deleteFile', section, $event)"
    />
    <AppButton v-if="!locked" class="group-add" variant="subtle" size="sm" @click="$emit('add', kind)">+ Добавить {{ kind === 'source' ? 'исходный' : 'проработанный' }}</AppButton>
  </section>
</template>
<script setup lang="ts">
import type { AnalysisSection, AnalysisFile } from '@core/models'
import AppButton from '@shared/ui/AppButton.vue'
import AnalysisSectionCard from './AnalysisSectionCard.vue'
defineProps<{ sections: AnalysisSection[]; kind: AnalysisSection['kind']; locked: boolean; highlights: string[]; opened: string | null; agentRevision: number }>()
defineEmits<{
  add: [kind: AnalysisSection['kind']]
  save: [section: AnalysisSection, data: { title: string; description: string }, finish: (saved: boolean) => void]
  remove: [section: AnalysisSection]
  move: [section: AnalysisSection, kind: AnalysisSection['kind']]
  reorder: [id: string, before: string]
  shift: [section: AnalysisSection, direction: number]
  upload: [section: AnalysisSection, files: File[]]
  file: [section: AnalysisSection, file: AnalysisFile]
  deleteFile: [section: AnalysisSection, file: AnalysisFile]
}>()
</script>
<style scoped>
.analysis-group { --group-color: var(--blue-hover); display: flex; flex-direction: column; gap: 6px; }
.analysis-group.worked { --group-color: var(--accent-hover); }
.group-head { display: flex; align-items: baseline; gap: 8px; padding: 0 2px 2px; }
.group-name { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 600; color: var(--group-color); text-transform: uppercase; letter-spacing: 0.5px; }
.group-dot { width: 8px; height: 8px; border-radius: 2px; background: var(--group-color); align-self: center; }
.group-count { font-size: 11px; font-weight: 600; color: var(--text-muted); }
.group-hint { font-size: 11.5px; color: var(--text-faint); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.group-empty { font-size: 12px; color: var(--text-faint); padding: 10px 12px; border: 1px dashed var(--border); border-radius: var(--radius); }
.group-add { align-self: flex-start; color: var(--text-muted); }
.group-add:not(:disabled):hover { color: var(--group-color); }
</style>
