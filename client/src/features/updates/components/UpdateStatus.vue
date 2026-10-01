<template>
  <div class="update-status app-no-drag">
    <div class="version-line">
      <span>{{ version ? `v${version}` : '' }}</span>
      <button
        v-if="card && hidden && state.status !== 'downloading'"
        class="version-update"
        title="Доступно обновление — показать"
        @click="dismissedKey = null"
      >Обновление {{ card.version }}</button>
    </div>

    <!-- Floats over the sidebar corner so it never shifts the navigation. -->
    <Teleport to="body">
      <Transition name="update-popup" mode="out-in">
        <div v-if="card && !hidden" :key="state.status" class="update-popup app-no-drag" :class="card.tone" role="status">
          <button class="update-close" :title="closeTitle" aria-label="Скрыть" @click="dismissedKey = cardKey">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8" /></svg>
          </button>

          <div class="update-head">
            <span class="update-icon">
              <svg v-if="state.status === 'downloading'" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2.5v8M4.5 7 8 10.5 11.5 7M3 13.5h10" /></svg>
              <svg v-else viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M8 13V3.5M4 7.5l4-4 4 4" /></svg>
            </span>
            <div class="update-text">
              <div class="update-title">{{ card.title }}</div>
              <div class="update-sub">{{ card.sub }}</div>
            </div>
          </div>

          <div v-if="state.status === 'downloading'" class="update-progress">
            <div class="update-progress-fill" :style="{ width: `${state.percent}%` }" />
          </div>
          <AppButton
            v-else-if="state.status === 'ready'"
            variant="primary"
            size="sm"
            class="update-action"
            @click="store.install()"
          >Обновить сейчас</AppButton>
          <AppButton
            v-else-if="state.status === 'manual'"
            variant="ghost"
            size="sm"
            class="update-action"
            @click="store.openRelease()"
          >Скачать вручную</AppButton>
        </div>
      </Transition>
    </Teleport>

    <InstallOverlay v-if="installing" :version="installing.version" :stage="installing.stage" />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { storeToRefs } from 'pinia'
import AppButton from '@shared/ui/AppButton.vue'
import InstallOverlay from './InstallOverlay.vue'
import { useUpdatesStore } from '../stores/updates'

defineProps<{ version: string }>()

const store = useUpdatesStore()
const { state, installing } = storeToRefs(store)
store.start()

const card = computed(() => {
  const s = state.value
  if (s.status === 'downloading') return { tone: 'downloading', version: s.version, title: 'Загрузка обновления', sub: `v${s.version} · ${s.percent}%` }
  if (s.status === 'ready') return { tone: 'ready', version: s.version, title: `Версия ${s.version}`, sub: 'Готова к установке' }
  if (s.status === 'manual') return { tone: 'manual', version: s.version, title: `Версия ${s.version}`, sub: 'Не удалось обновить автоматически' }
  return null
})

// Hiding is per status and version: a hidden download still pops up again once it is ready.
const dismissedKey = ref<string | null>(null)
const cardKey = computed(() => card.value && `${state.value.status}:${card.value.version}`)
const hidden = computed(() => dismissedKey.value !== null && dismissedKey.value === cardKey.value)

const closeTitle = computed(() => state.value.status === 'ready'
  ? 'Скрыть — обновление установится при выходе из приложения'
  : 'Скрыть')
</script>

<style scoped>
.update-status { margin-top: var(--sp-3); }

.version-line {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-2);
  min-height: 20px;
  padding: 0 6px;
  font-size: 11px;
  color: var(--text-faint);
}
.version-update {
  height: 20px;
  padding: 0 8px;
  border: 1px solid rgba(46, 160, 67, 0.4);
  border-radius: var(--radius-pill);
  background: var(--accent-soft);
  color: var(--accent-hover);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.12s, border-color 0.12s;
}
.version-update:hover { background: rgba(46, 160, 67, 0.25); border-color: var(--accent-hover); }

.update-popup {
  --tone: var(--blue-hover);
  --tone-soft: var(--blue-soft);
  position: fixed;
  left: var(--sp-3);
  bottom: var(--sp-3);
  z-index: 150;
  /* Exactly the sidebar's inner width, so it reads as part of the sidebar. */
  width: calc(236px - 2 * var(--sp-3));
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-lg);
  background: var(--bg2);
  box-shadow: var(--shadow-md);
}
.update-popup.ready { --tone: var(--accent-hover); --tone-soft: var(--accent-soft); border-color: rgba(46, 160, 67, 0.45); }
.update-popup.manual { --tone: var(--warning-text); --tone-soft: var(--warning-soft); }

.update-close {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 20px;
  height: 20px;
  padding: 0;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-faint);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background 0.12s, color 0.12s;
}
.update-close:hover { background: var(--bg3); color: var(--text); }
.update-close svg { width: 12px; height: 12px; }

.update-head { display: flex; align-items: center; gap: 8px; min-width: 0; padding-right: 18px; }
.update-icon {
  flex-shrink: 0;
  width: 26px;
  height: 26px;
  border-radius: var(--radius-sm);
  background: var(--tone-soft);
  color: var(--tone);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.update-icon svg { width: 14px; height: 14px; }
.update-text { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.update-title { font-size: 12.5px; font-weight: 600; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.update-sub { font-size: 11px; line-height: 1.35; color: var(--text-muted); font-variant-numeric: tabular-nums; }

.update-progress { height: 4px; border-radius: var(--radius-pill); background: var(--bg3); overflow: hidden; }
.update-progress-fill { height: 100%; border-radius: inherit; background: var(--tone); transition: width 0.3s ease; }

.update-action { width: 100%; }

.update-popup-enter-active, .update-popup-leave-active { transition: opacity 0.2s ease, transform 0.2s ease; }
.update-popup-enter-from, .update-popup-leave-to { opacity: 0; transform: translateY(8px); }
@media (prefers-reduced-motion: reduce) {
  .update-popup-enter-active, .update-popup-leave-active { transition: none; }
}
</style>
