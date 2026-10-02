<template>
  <!-- Children of one document, loaded when shown; each row can open its own children the same way. -->
  <ul class="tree">
    <li v-if="busy" class="state">{{ SECTIONS.loading }}</li>
    <li v-else-if="error" class="state error" role="alert">{{ error }} <button type="button" class="link" @click="load">{{ SECTIONS.retry }}</button></li>
    <li v-else-if="!children.length" class="state">{{ SECTIONS.noChildren }}</li>
    <li v-for="child in children" :key="child.id">
      <div class="node" :class="{ off: excluded.includes(child.id) }">
        <button
          type="button" class="toggle" :disabled="excluded.includes(child.id) || chain.includes(child.id)"
          :title="open.has(child.id) ? 'Свернуть' : 'Показать дочерние'" :aria-expanded="open.has(child.id)"
          @click="flip(child.id)"
        >{{ open.has(child.id) && !excluded.includes(child.id) ? '▾' : '▸' }}</button>
        <label><input type="checkbox" :checked="!excluded.includes(child.id)" @change="$emit('toggle', child)"> {{ child.title }}</label>
        <span class="id">{{ child.id }}</span>
      </div>
      <DocsTree
        v-if="open.has(child.id) && !excluded.includes(child.id) && !chain.includes(child.id)"
        :parent-id="child.id" :connection-id="connectionId" :config="config" :excluded="excluded" :chain="[...chain, parentId]"
        @toggle="$emit('toggle', $event)"
      />
    </li>
  </ul>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { api } from '@core/api'
import type { DocsNode } from '@core/models/integrations'
import { errorText } from '@shared/utils/errorText'
import { ERRORS, SECTIONS } from '../utils/docs-hints'

const props = withDefaults(defineProps<{ parentId: string; connectionId: string; config: Record<string, unknown>; excluded: string[]; chain?: string[] }>(), { chain: () => [] })
defineEmits<{ toggle: [node: DocsNode] }>()
const busy = ref(false), error = ref(''), children = ref<DocsNode[]>([]), open = ref(new Set<string>())
let revision = 0

async function load() {
  const current = ++revision
  busy.value = true; error.value = ''
  try {
    const result = await api.post<DocsNode[]>('/projects/draft/docs/children', { connection_id: props.connectionId, config: props.config, id: props.parentId })
    if (current === revision) children.value = result
  } catch (e) { if (current === revision) error.value = errorText(e, ERRORS) }
  finally { if (current === revision) busy.value = false }
}
function flip(id: string) { if (!open.value.delete(id)) open.value.add(id) }
// Other settings may list other children: reload instead of showing a stale tree.
watch(() => props.connectionId + JSON.stringify(props.config), () => { open.value.clear(); void load() })
onMounted(load)
</script>

<style scoped>
.tree { list-style: none; display: flex; flex-direction: column; gap: 2px; font-size: 12.5px; }
.tree .tree { margin: 2px 0 4px 11px; padding-left: 10px; border-left: 1px solid var(--border); }
.node { display: flex; align-items: center; gap: 6px; min-height: 26px; padding: 0 4px; border-radius: var(--radius-sm); }
.node:hover { background: var(--bg-hover); }
.node.off label { color: var(--text-faint); text-decoration: line-through; }
.node label { display: flex; align-items: center; gap: 6px; cursor: pointer; min-width: 0; overflow-wrap: anywhere; }
.toggle { width: 18px; height: 18px; flex-shrink: 0; padding: 0; border: none; background: none; color: var(--text-muted); cursor: pointer; font-size: 11px; border-radius: 4px; }
.toggle:not(:disabled):hover { background: var(--bg3); color: var(--text); }
.toggle:disabled { opacity: 0.3; cursor: default; }
.id { margin-left: auto; font-size: 11px; color: var(--text-faint); font-family: 'Cascadia Code', 'JetBrains Mono', monospace; }
.state { padding: 4px 8px; color: var(--text-muted); }
.state.error { color: var(--danger-hover); }
.link { padding: 0; border: none; background: none; color: var(--blue-hover); font: inherit; cursor: pointer; }
.link:hover { text-decoration: underline; }
</style>
