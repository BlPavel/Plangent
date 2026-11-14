<template>
  <AppConfirm :state="store.confirmState" @resolve="store.resolveConfirm" />
</template>

<script setup lang="ts">
import { useAppStore } from '@core/stores/app'
import AppConfirm from '@shared/ui/AppConfirm.vue'

const store = useAppStore()
</script>
