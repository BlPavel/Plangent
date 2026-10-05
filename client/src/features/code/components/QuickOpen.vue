<template>
  <Teleport to="body">
    <div class="qo-backdrop" @mousedown.self="emit('close')">
      <div class="qo" role="dialog" aria-label="Перейти к файлу">
        <input
          ref="input" v-model="query" class="qo-input" placeholder="Имя файла (нечёткий поиск)" spellcheck="false"
          @keydown.down.prevent="move(1)" @keydown.up.prevent="move(-1)" @keydown.enter.prevent="pick(hits[active]?.path)" @keydown.esc.prevent="emit('close')"
        />
        <div ref="list" class="qo-list">
          <div v-if="!files.length" class="qo-empty">Список файлов пуст</div>
          <div v-else-if="!hits.length" class="qo-empty">Ничего не найдено</div>
          <button
            v-for="(hit, index) in hits" :key="hit.path" type="button" class="qo-item" :class="{ active: index === active }"
            @mouseenter="active = index" @click="pick(hit.path)"
          >
            <!-- eslint-disable-next-line vue/no-v-html -- bundled icon set, not user input -->
            <span class="qo-icon" v-html="iconSvg(fileIconName(nameOf(hit.path)))" />
            <span class="qo-name"><template v-for="(part, i) in nameParts(hit)" :key="i"><b v-if="part.hit">{{ part.text }}</b><template v-else>{{ part.text }}</template></template></span>
            <span class="qo-dir">{{ dirOf(hit.path) }}</span>
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { fileIconName, iconSvg } from '@shared/code-viewer'
import { fuzzyFiles, type FuzzyHit } from '../utils/fuzzy'

const props = defineProps<{ files: string[] }>()
const emit = defineEmits<{ pick: [path: string]; close: [] }>()
const input = ref<HTMLInputElement>()
const list = ref<HTMLElement>()
const query = ref('')
const active = ref(0)

const hits = computed(() => fuzzyFiles(props.files, query.value, 50))
watch(hits, () => { active.value = 0 })
const nameOf = (path: string) => path.slice(path.lastIndexOf('/') + 1)
const dirOf = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '')

/** The file name split into highlighted and plain runs; matches in the folder part show in the path only. */
function nameParts(hit: FuzzyHit): { text: string; hit: boolean }[] {
  const start = hit.path.lastIndexOf('/') + 1
  const name = hit.path.slice(start)
  const marked = new Set(hit.positions.filter(p => p >= start).map(p => p - start))
  const parts: { text: string; hit: boolean }[] = []
  for (let i = 0; i < name.length; i++) {
    const on = marked.has(i)
    const last = parts[parts.length - 1]
    if (last && last.hit === on) last.text += name[i]
    else parts.push({ text: name[i], hit: on })
  }
  return parts
}

function move(delta: number) {
  if (!hits.value.length) return
  active.value = (active.value + delta + hits.value.length) % hits.value.length
  void nextTick(() => list.value?.querySelector('.active')?.scrollIntoView({ block: 'nearest' }))
}
function pick(path?: string) { if (path) emit('pick', path) }
onMounted(() => input.value?.focus())
</script>

<style scoped>
.qo-backdrop { position: fixed; inset: 0; z-index: 200; display: flex; justify-content: center; align-items: flex-start; padding-top: 12vh; background: rgba(0, 0, 0, 0.35); }
.qo { width: min(620px, 92vw); max-height: 60vh; display: flex; flex-direction: column; background: var(--bg2); border: 1px solid var(--border-strong); border-radius: var(--radius); box-shadow: var(--shadow-md); overflow: hidden; }
.qo-input { padding: 10px 14px; font: inherit; font-size: 14px; color: var(--text); background: var(--bg2); border: none; border-bottom: 1px solid var(--border); outline: none; }
.qo-list { overflow-y: auto; padding: 4px; }
.qo-empty { padding: 12px; font-size: 13px; color: var(--text-faint); }
.qo-item { width: 100%; display: flex; align-items: center; gap: 8px; padding: 4px 8px; font: inherit; font-size: 13px; text-align: left; color: var(--text); background: none; border: none; border-radius: var(--radius-sm); cursor: pointer; }
.qo-item.active { background: var(--blue-soft); }
.qo-icon { display: inline-flex; flex-shrink: 0; }
.qo-icon :deep(svg) { width: 16px; height: 16px; }
.qo-name { flex-shrink: 0; white-space: nowrap; }
.qo-name b { color: var(--blue-hover); font-weight: 600; }
.qo-dir { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; direction: rtl; text-align: left; font-size: 12px; color: var(--text-faint); }
</style>
