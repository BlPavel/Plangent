<template>
  <section v-if="recent.length" class="rr">
    <div class="rr-title">Последние ревью</div>
    <button v-for="item in recent" :key="item.id" type="button" class="rr-item" @click="store.openReview(item.id)">
      <span class="rr-head">#{{ item.number }}<span class="rr-status">{{ statusLabel(item) }}</span></span>
      <span class="rr-meta">{{ historyLine(item) }}</span>
    </button>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useCodeStore } from '../stores/code'
import { historyLine, statusLabel } from '../utils/history'

const store = useCodeStore()
const recent = computed(() => store.history.slice(0, 5))
// «Нет изменений, нет ревью» is the only state that shows history without being asked.
onMounted(() => { void store.loadHistory() })
</script>

<style scoped>
.rr { display: flex; flex-direction: column; gap: 4px; margin-top: 10px; }
.rr-title { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-faint); }
.rr-item { display: flex; flex-direction: column; gap: 2px; padding: 6px 8px; font: inherit; font-size: 12px; text-align: left; color: var(--text); background: var(--bg2); border: 1px solid var(--border); border-radius: var(--radius-sm); cursor: pointer; }
.rr-item:hover { background: var(--bg3); }
.rr-head { display: flex; align-items: center; gap: 6px; font-weight: 600; }
.rr-status { padding: 0 6px; font-size: 10px; font-weight: 500; border-radius: var(--radius-pill); background: var(--bg3); color: var(--text-muted); }
.rr-meta { font-size: 11px; color: var(--text-muted); }
</style>
