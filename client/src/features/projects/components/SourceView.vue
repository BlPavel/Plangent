<template>
  <div class="source">
    <div class="source-header app-drag">
      <div class="source-title">
        <h1><span class="source-icon">📘</span>@{{ source.key }}</h1>
        <span class="source-path">{{ source.repo_path }}</span>
      </div>
      <div class="source-actions">
        <AppButton variant="ghost" size="sm" @click="$emit('edit')">Настройки</AppButton>
        <AppButton variant="danger-ghost" size="sm" @click="$emit('delete')">Удалить</AppButton>
      </div>
    </div>

    <div class="source-body">
      <section>
        <h3>Описание для агента</h3>
        <p v-if="source.description" class="text">{{ source.description }}</p>
        <p v-else class="muted">Не задано. Агент увидит только имя и путь — с описанием ему проще понять, когда сюда заглядывать.</p>
      </section>
      <section>
        <h3>Доступно</h3>
        <p v-if="source.config.available_everywhere" class="text">Везде: агенты всех проектов знают об этом справочнике.</p>
        <template v-else-if="targets.length">
          <p class="text">Агенты этих групп и проектов знают о справочнике:</p>
          <div class="chips"><span v-for="t in targets" :key="t.id" class="chip">{{ t.kind === 'group' ? '🗂' : '📁' }} {{ t.name }}</span></div>
        </template>
        <p v-else class="muted">Никому — агент узнает о справочнике, только когда вы упомянете @{{ source.key }}.</p>
      </section>
      <section>
        <h3>Как пользоваться</h3>
        <p class="text">
          В чате или задаче напишите <code>@{{ source.key }}</code> или <code>@{{ source.key }}/путь/к/файлу</code>.
          Агент получает только имя, путь и описание — сами файлы читает, когда это нужно, и никогда не меняет.
        </p>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { Project } from '@core/models'
import AppButton from '@shared/ui/AppButton.vue'
import { useProjectsStore } from '../stores/projects'

const props = defineProps<{ source: Project }>()
defineEmits<{ edit: []; delete: [] }>()
const projectsStore = useProjectsStore()
const targets = computed(() => (props.source.targets ?? []).map(id => projectsStore.byId(id)).filter(p => !!p))
</script>

<style scoped>
.source { display: flex; flex-direction: column; height: 100%; overflow: hidden; }
.source-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--sp-4);
  padding: calc(var(--titlebar-h) + var(--sp-3)) var(--sp-6) var(--sp-3);
  border-bottom: 1px solid var(--border);
}
.source-title { min-width: 0; }
.source-title h1 { font-size: 18px; font-weight: 700; margin-bottom: 2px; font-family: 'Cascadia Code', 'JetBrains Mono', monospace; }
.source-icon { margin-right: 8px; font-family: initial; }
.source-path { display: block; font-size: 12px; color: var(--text-muted); font-family: 'Cascadia Code', 'JetBrains Mono', monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.source-actions { display: flex; gap: var(--sp-2); flex-shrink: 0; }
.source-body { flex: 1; overflow-y: auto; padding: var(--sp-5) var(--sp-6); display: flex; flex-direction: column; gap: var(--sp-5); max-width: 720px; }
h3 { font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-faint); margin-bottom: 6px; }
.text { font-size: 13px; line-height: 1.55; white-space: pre-wrap; }
.muted { font-size: 13px; color: var(--text-muted); }
.chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
.chip { padding: 3px 8px; background: var(--bg3); border: 1px solid var(--border-strong); border-radius: var(--radius-sm); font-size: 12px; }
code { padding: 1px 5px; background: var(--bg3); border-radius: 4px; font-size: 12px; }
</style>
