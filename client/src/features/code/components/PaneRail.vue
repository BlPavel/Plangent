<template>
  <nav class="pr" :class="side" :aria-label="side === 'left' ? 'Левая панель свёрнута' : 'Правая панель свёрнута'">
    <button type="button" class="pr-toggle" :title="`Развернуть панель (${shortcut})`" @click="emit('expand')">{{ side === 'left' ? '»' : '«' }}</button>
    <button v-for="item in items" :key="item.id" type="button" class="pr-item" :title="item.label" :aria-label="item.label" @click="emit('pick', item.id)">
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path v-for="(d, i) in ICONS[item.icon]" :key="i" :d="d" />
      </svg>
      <span v-if="item.count" class="pr-count" :class="item.tone">{{ item.count > 99 ? '99+' : item.count }}</span>
      <span v-else-if="item.dot" class="pr-dot" :class="item.dot" />
    </button>
  </nav>
</template>

<script setup lang="ts">
interface RailItem {
  id: string
  label: string
  icon: 'changes' | 'files' | 'search' | 'remarks' | 'chat'
  count?: number
  /** `warning` for counts that need the developer (decisions). */
  tone?: 'warning'
  /** Agent status shown as a dot when there is no count. */
  dot?: string
}

const ICONS: Record<RailItem['icon'], string[]> = {
  changes: ['M8 3v6M5 6h6', 'M5 12h6'],
  files: ['M2 4.5h4l1.5 1.5H14v6.5H2z'],
  search: ['M7 11.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9z', 'M10.3 10.3 14 14'],
  remarks: ['M2.5 3h11v7.5H7L4 13v-2.5H2.5z', 'M5.5 6.5h5'],
  chat: ['M3 4h10v6.5H8.5L6 13v-2.5H3z', 'M6 7.2h.01M8 7.2h.01M10 7.2h.01'],
}

defineProps<{ side: 'left' | 'right'; items: RailItem[]; shortcut: string }>()
const emit = defineEmits<{ pick: [id: string]; expand: [] }>()
</script>

<style scoped>
.pr { display: flex; flex-direction: column; align-items: center; gap: 4px; height: 100%; padding: 6px 0; background: var(--bg); }
.pr.left { border-right: 1px solid var(--border); }
.pr.right { border-left: 1px solid var(--border); }
.pr-toggle, .pr-item { position: relative; display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; padding: 0; font: inherit; font-size: 13px; color: var(--text-muted); background: none; border: none; border-radius: var(--radius-sm); cursor: pointer; }
.pr-toggle { margin-bottom: 4px; }
.pr-toggle:hover, .pr-item:hover { color: var(--text); background: var(--bg3); }
.pr-toggle:focus-visible, .pr-item:focus-visible { outline: 2px solid var(--blue); outline-offset: -1px; }
.pr-item svg { width: 16px; height: 16px; }
.pr-count { position: absolute; top: 0; right: -2px; min-width: 14px; padding: 0 3px; font-size: 9px; font-weight: 600; line-height: 14px; text-align: center; border-radius: var(--radius-pill); background: var(--bg3); color: var(--text-muted); }
.pr-count.warning { background: var(--warning-text); color: var(--bg); }
.pr-dot { position: absolute; top: 3px; right: 3px; width: 7px; height: 7px; border-radius: 50%; background: var(--border-strong); }
.pr-dot.thinking, .pr-dot.starting { background: var(--blue-hover); animation: pr-pulse 1.4s ease-in-out infinite; }
.pr-dot.waiting { background: var(--warning-text); }
.pr-dot.complete, .pr-dot.ready { background: var(--accent-hover); }
.pr-dot.error { background: var(--danger-hover); }
@keyframes pr-pulse { 50% { opacity: 0.35; } }
</style>
