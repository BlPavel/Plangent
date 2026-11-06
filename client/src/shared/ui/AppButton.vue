<template>
  <component :is="as" class="btn" :class="['btn-' + variant, size === 'md' ? '' : 'btn-' + size, { 'btn-icon': icon, pressed, block, multiline, wrap, start }, join && 'join-' + join]" :type="as === 'button' ? type : undefined" :disabled="as === 'button' ? disabled : undefined" :href="as === 'a' && !disabled ? href : undefined" :aria-disabled="disabled || undefined" :aria-pressed="pressed" :tabindex="disabled ? -1 : undefined" @click="click"><slot /></component>
</template>
<script setup lang="ts">
export type ButtonVariant = 'primary' | 'blue' | 'update' | 'ghost' | 'subtle' | 'suggestion' | 'danger-subtle' | 'disclosure' | 'danger' | 'danger-ghost' | 'link' | 'danger-link'
const props = withDefaults(defineProps<{ variant?: ButtonVariant; size?: 'md' | 'sm' | 'xs'; icon?: boolean; pressed?: boolean; block?: boolean; multiline?: boolean; wrap?: boolean; start?: boolean; as?: 'button' | 'a'; href?: string; disabled?: boolean; type?: 'button' | 'submit' | 'reset'; join?: 'start' | 'end' }>(), { variant: 'ghost', size: 'md', as: 'button', type: 'button' })
const emit = defineEmits<{ click: [event: MouseEvent] }>()
function click(event: MouseEvent) { if (props.disabled) { event.preventDefault(); event.stopPropagation(); return }; emit('click', event) }
</script>
<style scoped>
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: var(--size-md);
  padding: 0 16px;
  border-radius: var(--radius-btn);
  border: 1px solid transparent;
  cursor: pointer;
  font-size: var(--fs-md);
  font-weight: var(--fw-medium);
  font-family: inherit;
  line-height: var(--lh-tight);
  transition: background var(--motion-fast), border-color var(--motion-fast), color var(--motion-fast), opacity var(--motion-fast);
  white-space: nowrap;
  -webkit-app-region: no-drag;
}
.btn:disabled { opacity: 0.45; cursor: not-allowed; }
.btn:focus-visible { outline: var(--focus-outline); outline-offset: 1px; }

.btn-primary { background: var(--accent); color: var(--on-accent); border-color: var(--accent); }
.btn-primary:not(:disabled):hover { background: var(--accent-hover); border-color: var(--accent-hover); }

.btn-blue { background: var(--blue); color: var(--on-accent); border-color: var(--blue); }
.btn-blue:not(:disabled):hover { background: var(--blue-hover); border-color: var(--blue-hover); }

/* Maintenance action: intentionally distinct from the green primary/success action. */
.btn-update { background: var(--warning); color: var(--on-accent); border-color: var(--warning); }
.btn-update:not(:disabled):hover { background: var(--warning-text); border-color: var(--warning-text); color: var(--on-warning); }

.btn-ghost { background: var(--bg3); color: var(--text); border-color: var(--border-strong); }
.btn-ghost:not(:disabled):hover { background: var(--bg-hover); border-color: var(--text-faint); }

/* Quiet/tertiary button — no fill until hover, for low-emphasis actions */
.btn-suggestion { height: 30px; padding: 0 var(--sp-2); gap: var(--sp-2); justify-content: flex-start; text-align: left; font-family: var(--font-mono); font-size: var(--fs-md); font-weight: var(--fw-normal); background: transparent; color: var(--text); border-color: transparent; flex-shrink: 0; }
.btn-suggestion.wrap { height: auto; min-height: 30px; padding-block: var(--sp-1); align-items: center; line-height: var(--lh-normal); white-space: normal; }
.btn-suggestion:not(:disabled):hover { background: var(--bg-hover); }
.btn-subtle { background: transparent; color: var(--text-muted); border-color: transparent; }
.btn-subtle:not(:disabled):hover { background: var(--bg3); color: var(--text); }
.btn-danger-subtle { background: transparent; color: var(--text-muted); border-color: transparent; }
.btn-danger-subtle:not(:disabled):hover { background: var(--danger-soft); color: var(--danger-hover); }

.btn-danger { background: var(--danger); color: var(--on-accent); border-color: var(--danger); }
.btn-danger:not(:disabled):hover { background: var(--danger-hover); border-color: var(--danger-hover); }

/* Destructive but low-emphasis: red text, fills red only on hover */
.btn-danger-ghost { background: transparent; color: var(--danger-hover); border-color: var(--border-strong); }
.btn-danger-ghost:not(:disabled):hover { background: var(--danger); color: var(--on-accent); border-color: var(--danger); }

.btn-sm { height: var(--size-sm); padding: 0 12px; font-size: var(--fs-sm); gap: 5px; border-radius: var(--radius-sm); }
.btn-xs { height: var(--size-xs); padding: 0 8px; font-size: var(--fs-xs); border-radius: var(--radius-sm); gap: 4px; }

/* Square icon-only buttons keep the same footprint as text buttons */
.btn-icon { width: var(--size-md); padding: 0; }
.btn-icon.btn-sm { width: var(--size-sm); }
.btn-icon.btn-xs { width: var(--size-xs); }

/* Icons inside buttons inherit the button's colour so a danger button
   shows a red icon, a primary button a white one, etc. */
.btn svg, .btn :slotted(svg) { width: 15px; height: 15px; flex-shrink: 0; }
.btn-sm svg, .btn-sm :slotted(svg) { width: 14px; height: 14px; }
.btn-xs svg, .btn-xs :slotted(svg) { width: 12px; height: 12px; }


.btn { text-decoration: none; }
.btn-link, .btn-danger-link { background: transparent; border-color: transparent; padding-inline: var(--sp-1); color: var(--blue-hover); }
.btn-danger-link { color: var(--danger-hover); }
.btn-link:hover, .btn-danger-link:hover { text-decoration: underline; }
.btn.pressed { color: var(--blue-hover); background: var(--blue-soft); border-color: var(--blue); }
.btn.block { display: flex; width: 100%; }
.btn.multiline { height: auto; min-height: var(--size-md); white-space: normal; flex-direction: column; align-items: stretch; }
.btn.start { justify-content: flex-start; text-align: left; }
.btn-disclosure {
  height: auto;
  min-height: 32px;
  padding: 5px 10px;
  gap: 8px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  font-size: var(--fs-md);
  font-weight: var(--fw-normal);
}
.btn-disclosure:disabled { opacity: 1; cursor: default; }
.btn-disclosure:not(:disabled):hover { color: var(--text); background: var(--bg3); }
.btn[aria-disabled="true"] { opacity: .45; cursor: not-allowed; }
.join-start { border-top-right-radius: 0; border-bottom-right-radius: 0; }
.join-end { border-top-left-radius: 0; border-bottom-left-radius: 0; border-left-color: var(--divider-on-fill); }
</style>
