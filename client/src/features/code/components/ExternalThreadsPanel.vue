<template>
  <section class="ep">
    <div class="ep-head">
      <span class="ep-title">Замечания из МР</span>
      <span v-if="store.data?.mr" class="ep-muted">!{{ store.data.mr.iid }}</span>
      <span class="ep-spacer" />
      <a v-if="store.data?.mr" class="ep-link" :href="store.data.mr.url" target="_blank" rel="noreferrer">Открыть в GitLab</a>
      <AppButton size="xs" variant="ghost" :disabled="store.loading" title="Подтянуть обсуждения МР текущей ветки из GitLab" @click="store.pull()">{{ store.loading ? 'Загрузка…' : store.data ? 'Обновить' : 'Подтянуть замечания из МР' }}</AppButton>
    </div>
    <div v-if="store.error" class="ep-error">{{ store.error }}</div>
    <div v-else-if="store.data && !store.data.mr" class="ep-muted ep-pad">Для текущей ветки нет МР.</div>
    <div v-else-if="store.data && !store.data.threads.length" class="ep-muted ep-pad">В МР пока нет комментариев.</div>
    <div v-if="store.data?.threads.length" class="ep-list">
      <ExternalThreadCard v-for="t in store.data.threads" :key="t.id" :thread="t" show-location :can-discuss="canDiscuss" @goto="emit('goto', t)" @discuss="emit('discuss', $event)" />
    </div>
  </section>
</template>

<script setup lang="ts">
import AppButton from '@shared/ui/AppButton.vue'
import { useExternalThreadsStore } from '../stores/external'
import type { ExternalThread } from '../types'
import ExternalThreadCard from './ExternalThreadCard.vue'

defineProps<{ canDiscuss?: boolean }>()
const emit = defineEmits<{ goto: [thread: ExternalThread]; discuss: [thread: ExternalThread] }>()
const store = useExternalThreadsStore()
</script>

<style scoped>
.ep { flex-shrink: 0; max-height: 45%; display: flex; flex-direction: column; border-bottom: 1px solid var(--border); }
.ep-head { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; padding: 6px 8px 6px 12px; font-size: 12px; }
.ep-title { font-weight: 600; }
.ep-spacer { flex: 1; }
.ep-muted { font-size: 12px; color: var(--text-muted); }
.ep-pad { padding: 0 12px 8px; }
.ep-link { font-size: 11.5px; color: var(--blue-hover); }
.ep-error { margin: 0 12px 6px; font-size: 12px; color: var(--danger-hover); }
.ep-list { overflow-y: auto; padding: 0 8px 6px; }
</style>
