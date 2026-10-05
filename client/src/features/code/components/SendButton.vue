<template>
  <div ref="root" class="sb">
    <button type="button" class="sb-main" :disabled="disabled" :title="disabled ? reason : `Отправить в ${targetLabel}`" @click="emit('send', target)">
      {{ label }}
    </button>
    <button
      type="button" class="sb-more" :disabled="disabled" aria-label="Выбрать чат" :aria-expanded="open" title="Выбрать чат: текущий, другой или новый"
      @click="open = !open"
    >▾</button>
    <div v-if="open" class="sb-menu" role="menu">
      <div class="sb-heading">Куда отправить</div>
      <button v-for="chat in chats" :key="chat.id" type="button" role="menuitem" class="sb-item" :class="{ on: chat.id === target }" @click="pick(chat.id)">
        <span class="sb-dot" :class="chat.status" />
        <span class="sb-name">{{ chat.title }}</span>
        <span v-if="chat.id === defaultTarget" class="sb-hint">последний</span>
      </button>
      <button type="button" role="menuitem" class="sb-item" :class="{ on: target === '' }" @click="pick('')">
        <span class="sb-plus">+</span><span class="sb-name">Новый чат…</span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

/**
 * «Отправить» with the chat it goes to: by default the chat of the last round (a new chat when
 * there is none); ▾ picks another chat or a new one, and that choice sticks until the chats change.
 */
const props = defineProps<{
  label: string
  chats: { id: string; title: string; status: string }[]
  defaultTarget: string
  disabled?: boolean
  reason?: string
}>()
const emit = defineEmits<{ send: [target: string] }>()
const root = ref<HTMLElement>()
const open = ref(false)
const chosen = ref<string | null>(null)

const target = computed(() => (chosen.value !== null && (chosen.value === '' || props.chats.some(c => c.id === chosen.value)) ? chosen.value : props.defaultTarget))
const targetLabel = computed(() => {
  const chat = props.chats.find(c => c.id === target.value)
  return chat ? `чат «${chat.title}»` : 'новый чат'
})
watch(() => props.defaultTarget, () => { chosen.value = null })

function pick(id: string) {
  chosen.value = id
  open.value = false
  emit('send', id)
}
const close = (event: MouseEvent) => { if (!root.value?.contains(event.target as Node)) open.value = false }
onMounted(() => document.addEventListener('mousedown', close))
onBeforeUnmount(() => document.removeEventListener('mousedown', close))
</script>

<style scoped>
.sb { position: relative; display: inline-flex; }
.sb-main, .sb-more { white-space: nowrap; font: inherit; font-size: 12px; font-weight: 500; color: #fff; background: var(--blue); border: none; cursor: pointer; }
.sb-main { padding: 3px 10px; border-radius: var(--radius-sm) 0 0 var(--radius-sm); }
.sb-more { padding: 3px 6px; border-left: 1px solid rgba(255, 255, 255, 0.25); border-radius: 0 var(--radius-sm) var(--radius-sm) 0; }
.sb-main:hover:not(:disabled), .sb-more:hover:not(:disabled) { background: var(--blue-hover); }
.sb-main:disabled, .sb-more:disabled { opacity: 0.5; cursor: default; }
.sb-main:focus-visible, .sb-more:focus-visible, .sb-item:focus-visible { outline: 2px solid var(--blue-hover); outline-offset: 1px; }
.sb-menu { position: absolute; top: calc(100% + 4px); right: 0; z-index: 20; min-width: 240px; max-width: 320px; padding: 4px; background: var(--bg2); border: 1px solid var(--border-strong); border-radius: var(--radius); box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35); }
.sb-heading { padding: 4px 8px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-faint); }
.sb-item { display: flex; align-items: center; gap: 8px; width: 100%; padding: 5px 8px; font: inherit; font-size: 12px; text-align: left; color: var(--text); background: none; border: none; border-radius: var(--radius-sm); cursor: pointer; }
.sb-item:hover { background: var(--bg3); }
.sb-item.on { background: var(--blue-soft); }
.sb-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sb-hint { font-size: 11px; color: var(--text-faint); }
.sb-plus { width: 7px; text-align: center; color: var(--text-muted); }
.sb-dot { width: 7px; height: 7px; flex-shrink: 0; border-radius: 50%; background: var(--border-strong); }
.sb-dot.thinking, .sb-dot.starting { background: var(--blue-hover); }
.sb-dot.waiting { background: var(--warning-text); }
.sb-dot.complete, .sb-dot.ready { background: var(--accent-hover); }
.sb-dot.error { background: var(--danger-hover); }
</style>
