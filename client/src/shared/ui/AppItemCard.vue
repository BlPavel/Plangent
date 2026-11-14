<template>
  <component
    :is="as"
    class="item-card"
    :class="[accent && 'accent-' + accent, { nested, compact, interactive, selected, dimmed, highlighted, 'center-actions': actionsAlign === 'center' }]"
    :role="interactive ? 'button' : undefined"
    :tabindex="interactive ? 0 : undefined"
    @click="interactive && emit('click', $event)"
    @keydown.enter.self="interactive && emit('click', $event)"
  >
    <div class="item-card-head">
      <div v-if="$slots.lead" class="item-card-lead"><slot name="lead" /></div>
      <div class="item-card-main">
        <div class="item-card-title" data-item-title><slot name="title" /></div>
        <div v-if="$slots.subtitle" class="item-card-subtitle"><slot name="subtitle" /></div>
      </div>
      <div v-if="$slots.actions" class="item-card-actions"><slot name="actions" /></div>
    </div>
    <div v-if="$slots.default" class="item-card-body"><slot /></div>
  </component>
</template>

<script setup lang="ts">
/**
 * A list card: title with badges, a quieter subtitle, buttons on the right and
 * the rest (meta lines, messages, nested cards) below. Pure layout, no behaviour.
 * `nested` is a smaller card inside another card, `compact` a tighter one for dense lists,
 * `accent` a coloured stripe for the state, `interactive` makes the whole card a button,
 * `selected` / `dimmed` / `highlighted` mark the current, the finished and the fresh item.
 */
withDefaults(defineProps<{
  as?: 'div' | 'section' | 'article'
  accent?: 'blue' | 'warning' | 'success' | 'danger' | 'muted'
  nested?: boolean
  compact?: boolean
  interactive?: boolean
  selected?: boolean
  dimmed?: boolean
  highlighted?: boolean
  actionsAlign?: 'start' | 'center'
}>(), { as: 'div', accent: undefined })
const emit = defineEmits<{ click: [event: Event] }>()
</script>

<style scoped>
.item-card { overflow-wrap: anywhere; display: flex; flex-direction: column; gap: var(--sp-2); min-width: 0; padding: var(--sp-3) var(--sp-4); background: var(--bg2); border: 1px solid var(--border); border-radius: var(--radius); transition: border-color var(--motion-fast), background var(--motion-fast), box-shadow var(--motion-slow); }
.item-card:hover { border-color: var(--border-strong); }
.item-card.nested { padding: var(--sp-2) var(--sp-3); background: var(--bg); border-radius: var(--radius-sm); }
.item-card.compact { gap: var(--sp-1); padding: var(--sp-2) var(--sp-3); border-radius: var(--radius-sm); font-size: var(--fs-sm); }
.item-card.compact .item-card-title { font-size: var(--fs-sm); }
.item-card.interactive { cursor: pointer; }
.item-card.interactive:hover, .item-card.interactive:focus-visible { background: var(--bg3); border-color: var(--border-strong); outline: none; }
.item-card.selected { border-color: var(--blue); }
.item-card.dimmed { opacity: 0.75; }
.item-card.highlighted { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }

.item-card[class*='accent-'] { border-left-width: 3px; }
.item-card.accent-blue { border-left-color: var(--blue); }
.item-card.accent-warning { border-left-color: var(--warning); }
.item-card.accent-success { border-left-color: var(--accent); }
.item-card.accent-danger { border-left-color: var(--danger-hover); }
.item-card.accent-muted { border-left-color: var(--border-strong); }

.item-card-head { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--sp-3); }
.item-card-lead { flex-shrink: 0; display: flex; align-items: center; align-self: center; }
.item-card-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.item-card-title { display: flex; align-items: center; flex-wrap: wrap; gap: var(--sp-2); font-size: var(--fs-md); font-weight: var(--fw-semibold); }
.item-card-subtitle { font-size: var(--fs-sm); color: var(--text-muted); overflow-wrap: anywhere; }
.item-card-actions { flex-shrink: 0; display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 6px; max-width: 100%; }
.item-card.center-actions .item-card-actions { align-self: center; }
.item-card-body { display: flex; flex-direction: column; gap: var(--sp-2); min-width: 0; }
.item-card.compact .item-card-body { gap: var(--sp-1); }
</style>
