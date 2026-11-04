<template>
  <AppToast :toasts="store.toasts" @dismiss="store.dismissToast" @action="runAction" />
</template>

<script setup lang="ts">
import { useAppStore } from '@core/stores/app'
import AppToast from '@shared/ui/AppToast.vue'

const store = useAppStore()
function runAction(id: number) {
  const action = store.toasts.find(toast => toast.id === id)?.action
  store.dismissToast(id)
  action?.run()
}
</script>
