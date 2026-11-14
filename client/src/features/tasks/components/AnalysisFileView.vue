<template>
  <div class="file-view" role="dialog" :aria-label="file.name">
    <header class="file-view-head">
      <div class="file-view-title">
        <span class="file-view-name">{{ file.name }}</span>
        <span class="file-view-meta">{{ file.mime || 'файл' }} · {{ file.size < 1024 * 1024 ? Math.ceil(file.size / 1024) + ' КБ' : (file.size / 1024 / 1024).toFixed(1) + ' МБ' }}</span>
      </div>
      <AppButton as="a" size="sm" :href="url + '?download=true'" download>
        <svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 2.5v8M4.5 7L8 10.5 11.5 7M3 13.5h10" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" /></svg>
        Скачать
      </AppButton>
      <AppButton variant="subtle" size="sm" icon title="Закрыть файл" aria-label="Закрыть файл" @click="$emit('close')">
        <UIIconClose />
      </AppButton>
    </header>
    <div class="file-view-body">
      <div v-if="error" class="file-view-error" role="alert">{{ error }}</div>
      <img v-if="file.mime.startsWith('image/')" class="file-view-image" :src="url" :alt="file.name">
      <pre v-else-if="text !== null" class="file-view-text">{{ text }}</pre>
      <iframe v-else-if="file.mime === 'application/pdf'" class="file-view-pdf" :src="url" :title="file.name" sandbox="" />
      <div v-else-if="!error" class="file-view-none">Предпросмотр для этого типа файла недоступен. Скачайте файл, чтобы открыть его.</div>
    </div>
  </div>
</template>
<script setup lang="ts">
import { IconClose as UIIconClose } from '@shared/ui/icons'
import { ref, watch } from 'vue'
import { analysisText } from '../api'
import type { AnalysisFile } from '@contracts'
import AppButton from '@shared/ui/AppButton.vue'
const props = defineProps<{ file: AnalysisFile; url: string }>()
defineEmits<{ close: [] }>()
const text = ref<string | null>(null), error = ref('')
watch(() => props.url, async url => {
  text.value = null; error.value = ''
  if (!props.file.mime.startsWith('text/') && !/json|yaml|xml/.test(props.file.mime) && !/\.(md|txt|json|ya?ml|csv|xml)$/i.test(props.file.name)) return
  try { const value = await analysisText(url); if (url === props.url) text.value = value }
  catch (e) { if (url === props.url) error.value = String(e) }
}, { immediate: true })
</script>
<style scoped>
.file-view { display: flex; flex-direction: column; min-height: 0; background: var(--bg2); border: 1px solid var(--border-strong); border-radius: var(--radius-lg); box-shadow: var(--shadow-lg); overflow: hidden; }
.file-view-head { display: flex; align-items: center; gap: 8px; padding: 10px 12px 10px 16px; border-bottom: 1px solid var(--border); flex-shrink: 0; }
.file-view-title { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.file-view-name { font-size: var(--fs-base); font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.file-view-meta { font-size: var(--fs-xs); color: var(--text-faint); }
.file-view-head a.btn { text-decoration: none; }
.file-view-body { flex: 1; min-height: 0; overflow: auto; display: flex; flex-direction: column; background: var(--bg); }
.file-view-image { display: block; max-width: 100%; margin: auto; padding: 16px; object-fit: contain; }
.file-view-text { margin: 0; padding: 16px; white-space: pre-wrap; word-break: break-word; font-family: var(--font-mono); font-size: var(--fs-md); line-height: 1.55; color: var(--text); }
.file-view-pdf { width: 100%; height: 75vh; border: none; background: var(--on-accent); }
.file-view-none { margin: auto; padding: 48px 24px; font-size: var(--fs-md); color: var(--text-muted); text-align: center; }
.file-view-error { margin: 12px 16px 0; padding: 8px 12px; font-size: var(--fs-sm); border: 1px solid var(--danger); border-radius: var(--radius-sm); background: var(--danger-soft); color: var(--danger-hover); }
</style>
