<template>
  <button class="btn" :class="[`btn-${variant}`, sizeClass, { 'btn-icon': icon }]">
    <slot />
  </button>
</template>

<script setup lang="ts">
import { computed } from 'vue'

/**
 * The one button. Every clickable action should use this so variant + size
 * stay consistent app-wide. Native button attributes (disabled, type, @click,
 * title…) fall through automatically.
 */
type Variant = 'primary' | 'blue' | 'ghost' | 'subtle' | 'danger' | 'danger-ghost'
type Size = 'md' | 'sm' | 'xs'

const props = withDefaults(defineProps<{
  variant?: Variant
  size?: Size
  /** icon-only: renders a square button sized to its height */
  icon?: boolean
}>(), {
  variant: 'ghost',
  size: 'md',
  icon: false,
})

const sizeClass = computed(() => (props.size === 'md' ? '' : `btn-${props.size}`))
</script>
