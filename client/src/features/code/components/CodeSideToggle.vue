<template>
  <AppButton variant="subtle" size="sm" :pressed="open && available" :aria-expanded="open && available" :disabled="!available" title="Код (Ctrl+Shift+E)" @click="open = !open">
    <UIIconCode />
    Код
  </AppButton>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'
import { IconCode as UIIconCode } from '@shared/ui/icons'
import AppButton from '@shared/ui/AppButton.vue'

/** The status-bar button which shows and hides the side code panel; unavailable where the screen already shows code. */
const props = defineProps<{ available: boolean }>()
const open = defineModel<boolean>('open', { required: true })

// Ctrl+Shift+E, as in VS Code; `code` works in any keyboard layout.
function onKey(event: KeyboardEvent) {
  if (event.ctrlKey && event.shiftKey && !event.altKey && event.code === 'KeyE' && props.available) { event.preventDefault(); open.value = !open.value }
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>
