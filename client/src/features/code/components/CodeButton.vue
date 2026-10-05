<template>
  <AppButton variant="ghost" size="sm" :title="title" @click="open">
    <span class="cb-icon">&lt;/&gt;</span> Код<span v-if="changed" class="tab-count" :class="{ warn: attention }">{{ changed }}</span>
  </AppButton>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { onServerEvent } from '@core/api/events'
import AppButton from '@shared/ui/AppButton.vue'
import { useCodeAttentionStore } from '../stores/attention'
import { codeTarget } from '../navigation'

const props = defineProps<{ projectId: string; task: { id: string; key: string } }>()
const router = useRouter()
const store = useCodeAttentionStore()

const changed = computed(() => store.changed[props.projectId] ?? 0)
// Items waiting for a decision turn the counter yellow; they count even when the worktree is clean (everything committed).
const attention = computed(() => store.countFor(store.forTask(props.task.id)))
const title = computed(() => attention.value
  ? `Нужно ваше решение: ${attention.value}. Открыть код проекта`
  : changed.value ? `Изменённых файлов: ${changed.value}. Открыть код проекта` : 'Открыть код проекта')

function open() { void router.push(codeTarget(props.projectId, props.task)) }

// The task page does not watch the folder: the number follows the agents' activity and a return to the window.
let stopEvents: (() => void) | undefined
const refresh = () => store.scheduleChanged(props.projectId)
onMounted(() => {
  void store.load(props.projectId)
  void store.loadChanged(props.projectId)
  stopEvents = onServerEvent<{ type: string; projectId?: string }>(event => {
    if (['queue_updated', 'agent_session', 'code_review_updated'].includes(event.type)) refresh()
  })
  window.addEventListener('focus', refresh)
})
onBeforeUnmount(() => { stopEvents?.(); window.removeEventListener('focus', refresh) })
watch(() => props.projectId, id => { void store.load(id); void store.loadChanged(id) })
</script>

<style scoped>
.cb-icon { font-family: 'Cascadia Code', 'JetBrains Mono', monospace; font-size: 11px; }
.tab-count { min-width: 18px; height: 18px; margin-left: 6px; padding: 0 5px; border-radius: var(--radius-pill); font-size: 11px; font-weight: 700; display: inline-flex; align-items: center; justify-content: center; background: var(--bg3); color: var(--text-muted); }
.tab-count.warn { background: var(--warning); color: #0d1117; }
</style>
