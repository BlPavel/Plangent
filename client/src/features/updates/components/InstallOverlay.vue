<template>
  <Teleport to="body">
    <div class="install-overlay" role="alertdialog" aria-live="polite" aria-busy="true">
      <div class="install-box">
        <div class="install-logo">⚡</div>
        <h2 class="install-title">Обновление до версии {{ version }}</h2>
        <p class="install-stage">{{ stageText }}</p>
        <div class="install-progress"><div class="install-progress-bar" /></div>
        <p class="install-hint">
          Plangent закроется, установит новую версию и запустится снова — обычно это занимает меньше минуты.
        </p>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { InstallStage } from '../stores/updates'

const props = defineProps<{ version: string; stage: InstallStage }>()

const stageText = computed(() => props.stage === 'stopping'
  ? 'Останавливаем агентов и сохраняем данные…'
  : 'Запускаем установщик…')
</script>

<style scoped>
/* Above every toast and dialog: the backend is going away, nothing underneath is usable anymore. */
.install-overlay {
  position: fixed;
  inset: 0;
  z-index: 2000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(1, 4, 9, 0.82);
  backdrop-filter: blur(4px);
  animation: install-fade 0.2s ease;
}
.install-box {
  width: 380px;
  max-width: 92vw;
  padding: 28px 28px 24px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-lg);
  background: var(--bg2);
  box-shadow: var(--shadow-lg);
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
}
.install-logo {
  width: 48px;
  height: 48px;
  margin-bottom: var(--sp-4);
  border-radius: var(--radius-lg);
  background: var(--accent-soft);
  font-size: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.install-title { font-size: 16px; font-weight: 700; letter-spacing: -0.01em; }
.install-stage { margin-top: 6px; font-size: 13px; color: var(--text-muted); }
.install-progress {
  position: relative;
  width: 100%;
  height: 4px;
  margin: var(--sp-5) 0 var(--sp-4);
  border-radius: var(--radius-pill);
  background: var(--bg3);
  overflow: hidden;
}
/* Indeterminate: the shell doesn't report how far the backend shutdown or the installer got. */
.install-progress-bar {
  position: absolute;
  inset: 0 auto 0 0;
  width: 40%;
  border-radius: inherit;
  background: var(--accent-hover);
  animation: install-slide 1.3s ease-in-out infinite;
}
.install-hint { font-size: 12px; line-height: 1.5; color: var(--text-faint); }

@keyframes install-fade { from { opacity: 0; } }
@keyframes install-slide {
  from { transform: translateX(-100%); }
  to { transform: translateX(250%); }
}
@media (prefers-reduced-motion: reduce) {
  .install-overlay { animation: none; }
  .install-progress-bar { animation: none; width: 100%; opacity: 0.6; }
}
</style>
