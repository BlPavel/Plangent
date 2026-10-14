<template>
  <div ref="root" class="coauthors">
    <span v-for="person in modelValue" :key="person.email" class="ca-chip" :title="person.email">
      {{ person.name }}<button type="button" class="ca-x" :aria-label="'Убрать ' + person.name" @click="remove(person)">×</button>
    </span>
    <button type="button" class="ca-add" :aria-expanded="open" @click="toggle">+ Соавтор</button>
    <div v-if="open" class="ca-list" role="dialog" aria-label="Соавторы" @keydown.esc.stop.prevent="open = false">
      <input ref="search" v-model="query" class="ca-search" placeholder="Имя <email> или поиск" aria-label="Соавтор" @keydown.enter.prevent="addTyped" />
      <button v-for="person in shown" :key="person.email" type="button" class="ca-item" @click="add(person)">
        <span>{{ person.name }}</span><span class="ca-mail">{{ person.email }}</span>
      </button>
      <div v-if="typed" class="ca-hint">Enter — добавить «{{ typed.name }} &lt;{{ typed.email }}&gt;»</div>
      <div v-else-if="!shown.length" class="ca-hint">{{ known.length ? 'Никого не найдено' : 'В истории репозитория соавторов нет' }}. Введите «Имя &lt;email&gt;».</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref } from 'vue'
import type { Coauthor } from '../git-types'

/** People added as Co-authored-by: picked from the repository history or typed as «Имя <email>». */
const props = defineProps<{ modelValue: Coauthor[]; known: Coauthor[] }>()
const emit = defineEmits<{ 'update:modelValue': [value: Coauthor[]] }>()
const root = ref<HTMLElement>(), search = ref<HTMLInputElement>()
const open = ref(false), query = ref('')
const shown = computed(() => {
  const q = query.value.trim().toLowerCase()
  return props.known.filter(p => !props.modelValue.some(m => m.email === p.email) && (!q || p.name.toLowerCase().includes(q) || p.email.toLowerCase().includes(q)))
})
const typed = computed(() => {
  const match = /^(.+?)\s*<([^<>\s]+@[^<>\s]+)>$/.exec(query.value.trim())
  return match ? { name: match[1].trim(), email: match[2] } : null
})
function add(person: Coauthor) {
  if (!props.modelValue.some(m => m.email === person.email)) emit('update:modelValue', [...props.modelValue, person])
  close()
}
function addTyped() { if (typed.value) add(typed.value); else if (shown.value.length === 1) add(shown.value[0]) }
const remove = (person: Coauthor) => emit('update:modelValue', props.modelValue.filter(m => m.email !== person.email))
function outside(event: PointerEvent) { if (!root.value?.contains(event.target as Node)) close() }
function close() { open.value = false; query.value = ''; document.removeEventListener('pointerdown', outside) }
async function toggle() {
  if (open.value) { close(); return }
  open.value = true
  document.addEventListener('pointerdown', outside)
  await nextTick(); search.value?.focus()
}
onBeforeUnmount(close)
</script>

<style scoped>
.coauthors { position: relative; display: flex; flex-wrap: wrap; align-items: center; gap: 4px; font-size: 12px; }
.ca-chip { display: inline-flex; align-items: center; gap: 2px; padding: 1px 3px 1px 8px; color: var(--blue-hover); background: var(--blue-soft); border-radius: var(--radius-pill); }
.ca-x { padding: 0 4px; font: inherit; line-height: 1; color: inherit; background: none; border: none; cursor: pointer; }
.ca-add { padding: 1px 8px; font: inherit; color: var(--text-muted); background: none; border: 1px dashed var(--border-strong); border-radius: var(--radius-pill); cursor: pointer; }
.ca-add:hover { color: var(--text); border-color: var(--blue); }
.ca-list { position: absolute; z-index: 20; bottom: calc(100% + 4px); left: 0; width: 100%; min-width: 240px; max-height: 260px; overflow: auto; padding: 4px; display: flex; flex-direction: column; gap: 1px; background: var(--bg2); border: 1px solid var(--border-strong); border-radius: var(--radius); box-shadow: var(--shadow-md); }
.ca-search { margin-bottom: 4px; padding: 4px 8px; font: inherit; color: var(--text); background: var(--bg3); border: 1px solid var(--border); border-radius: var(--radius-sm); }
.ca-search:focus { outline: none; border-color: var(--blue); }
.ca-item { display: flex; align-items: baseline; gap: 8px; padding: 5px 8px; font: inherit; text-align: left; color: var(--text); background: none; border: none; border-radius: var(--radius-sm); cursor: pointer; }
.ca-item:hover { background: var(--bg-hover); }
.ca-mail, .ca-hint { font-size: 11.5px; color: var(--text-faint); }
.ca-hint { padding: 4px 8px; }
</style>
