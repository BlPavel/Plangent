<template>
  <div class="update-status app-no-drag">
    <button
      v-if="state.status === 'ready'"
      class="update-btn"
      :title="`Версия ${state.version} загружена. Если не перезапускать сейчас, она установится при выходе из приложения`"
      @click="store.install()"
    >Обновить Plangent</button>
    <button
      v-else-if="state.status === 'manual'"
      class="update-btn"
      :title="`Версия ${state.version}: автоматически обновить не получилось — откроется страница загрузки`"
      @click="store.openRelease()"
    >Скачать обновление</button>
    <div class="version-line">{{ version ? `v${version}` : '' }}</div>
  </div>
</template>

<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useUpdatesStore } from '../stores/updates'

defineProps<{ version: string }>()

const store = useUpdatesStore()
const { state } = storeToRefs(store)
store.start()
</script>

<style scoped>
.update-status { margin-top: var(--sp-3); display: flex; flex-direction: column; gap: var(--sp-2); }
.update-btn {
  width: 100%;
  height: var(--control-h);
  border: none;
  border-radius: var(--radius-btn);
  background: var(--accent);
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.12s;
}
.update-btn:hover { background: var(--accent-hover); }
.version-line { padding: 0 6px; font-size: 11px; color: var(--text-faint); }
</style>
