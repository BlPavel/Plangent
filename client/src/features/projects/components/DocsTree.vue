<template>
  <!-- Children of one document, loaded when shown; each row can open its own children the same way. -->
  <ul class="tree">
    <li v-if="busy" class="state">{{ SECTIONS.loading }}</li>
    <li v-else-if="error" class="state error" role="alert">{{ error }} <AppButton variant="link" size="xs" @click="load">{{ SECTIONS.retry }}</AppButton></li>
    <li v-else-if="!children.length" class="state">{{ SECTIONS.noChildren }}</li>
    <li v-for="child in children" :key="child.id">
      <div class="node" :class="{ off: excluded.includes(child.id) }">
        <AppButton
          variant="subtle" size="xs" icon :disabled="excluded.includes(child.id) || chain.includes(child.id)"
          :title="open.has(child.id) ? 'Свернуть' : 'Показать дочерние'" :aria-expanded="open.has(child.id)"
          @click="flip(child.id)"
        >{{ open.has(child.id) && !excluded.includes(child.id) ? '▾' : '▸' }}</AppButton>
        <AppCheckbox :model-value="!excluded.includes(child.id)" @update:model-value="$emit('toggle', child)">{{ child.title }}</AppCheckbox>
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
import { AppButton, AppCheckbox } from '@shared/ui'
import { projectsEndpoints } from '../api'


import { onMounted, ref, watch } from 'vue'
import type { DocsNode } from '@contracts'
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
    const result = await projectsEndpoints.postProjectsByIdDocsChildren({ params: { id: "draft" }, body: { connection_id: props.connectionId, config: props.config, id: props.parentId } })
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
.tree { list-style: none; display: flex; flex-direction: column; gap: 2px; font-size: var(--fs-md); }
.tree .tree { margin: 2px 0 4px 11px; padding-left: 10px; border-left: 1px solid var(--border); }
.node { display: flex; align-items: center; gap: 6px; min-height: 26px; padding: 0 4px; border-radius: var(--radius-sm); }
.node:hover { background: var(--bg-hover); }
.id { margin-left: auto; font-size: var(--fs-xs); color: var(--text-faint); font-family: var(--font-mono); }
.state { padding: 4px 8px; color: var(--text-muted); }
.state.error { color: var(--danger-hover); }
</style>
