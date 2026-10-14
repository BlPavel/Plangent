<template>
  <span ref="root" class="member-picker">
    <button type="button" class="mp-add" :disabled="!members.length" @click="toggle">+ Добавить</button>
    <div v-if="open" class="mp-list" role="listbox">
      <input v-if="members.length > 6" ref="search" v-model="query" class="mp-search" placeholder="Поиск…" @keydown.esc="open = false" />
      <button v-for="member in shown" :key="member.value" type="button" class="mp-item" @click="pick(member.value)">
        <span class="mp-name">{{ member.name }}</span><span class="mp-login">@{{ member.login }}</span>
      </button>
      <div v-if="!shown.length" class="mp-empty">Никого не найдено</div>
    </div>
  </span>
</template>
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref } from 'vue'

/** «+ Добавить» with a dropdown of the repository's people; picks one at a time. */
const props = defineProps<{ members: { value: string; login: string; name: string }[] }>()
const emit = defineEmits<{ pick: [value: string] }>()
const root = ref<HTMLElement>(), search = ref<HTMLInputElement>()
const open = ref(false), query = ref('')
const shown = computed(() => {
  const q = query.value.trim().toLowerCase()
  return props.members.filter(m => !q || m.name.toLowerCase().includes(q) || m.login.toLowerCase().includes(q))
})
function outside(event: PointerEvent) { if (!root.value?.contains(event.target as Node)) open.value = false }
async function toggle() {
  open.value = !open.value
  query.value = ''
  if (open.value) { document.addEventListener('pointerdown', outside); await nextTick(); search.value?.focus() }
  else document.removeEventListener('pointerdown', outside)
}
function pick(value: string) { emit('pick', value); open.value = false; document.removeEventListener('pointerdown', outside) }
onBeforeUnmount(() => document.removeEventListener('pointerdown', outside))
</script>
<style scoped>
.member-picker { position: relative; display: inline-flex; }
.mp-add { padding: 2px 8px; font: inherit; font-size: 12px; color: var(--text-muted); background: none; border: 1px dashed var(--border-strong); border-radius: var(--radius-pill); cursor: pointer; }
.mp-add:hover:not(:disabled) { color: var(--text); border-color: var(--blue); }
.mp-add:disabled { opacity: 0.5; cursor: default; }
.mp-list { position: absolute; z-index: 20; top: calc(100% + 4px); left: 0; min-width: 240px; max-height: 260px; overflow: auto; padding: 4px; display: flex; flex-direction: column; gap: 1px; background: var(--bg2); border: 1px solid var(--border-strong); border-radius: var(--radius); box-shadow: var(--shadow-md); }
.mp-search { margin-bottom: 4px; padding: 4px 8px; font: inherit; font-size: 12px; color: var(--text); background: var(--bg3); border: 1px solid var(--border); border-radius: var(--radius-sm); }
.mp-search:focus { outline: none; border-color: var(--blue); }
.mp-item { display: flex; align-items: baseline; gap: 8px; padding: 5px 8px; font: inherit; font-size: 12.5px; text-align: left; color: var(--text); background: none; border: none; border-radius: var(--radius-sm); cursor: pointer; }
.mp-item:hover { background: var(--bg-hover); }
.mp-login { font-size: 11.5px; color: var(--text-faint); }
.mp-empty { padding: 6px 8px; font-size: 12px; color: var(--text-faint); }
</style>
