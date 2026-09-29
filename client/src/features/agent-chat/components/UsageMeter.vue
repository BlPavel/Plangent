<template>
  <div v-if="context || windows.length" ref="root" class="usage" @mouseenter="open = true" @mouseleave="open = false">
    <button type="button" class="usage-trigger" @click="open = !open">
      <span v-if="context" class="meter" :class="tone(context.percent)" title="Контекст">
        <svg class="ring" viewBox="0 0 20 20">
          <circle cx="10" cy="10" r="7.5" class="ring-track" />
          <circle cx="10" cy="10" r="7.5" class="ring-fill" :stroke-dasharray="dash(context.percent)" />
        </svg>
        <span class="meter-text">{{ context.percent }}%</span>
      </span>
      <span v-if="tightest" class="meter" :class="tone(tightest.percent)" title="Лимит подписки">
        <svg class="ring" viewBox="0 0 20 20">
          <circle cx="10" cy="10" r="7.5" class="ring-track" />
          <circle cx="10" cy="10" r="7.5" class="ring-fill" :stroke-dasharray="dash(tightest.percent)" />
        </svg>
        <span class="meter-text"><span class="meter-label">{{ short(tightest.label) }}</span> {{ tightest.percent >= 100 ? 'исчерпан' : tightest.percent + '%' }}</span>
      </span>
    </button>

    <Transition name="pop">
      <div v-if="open" class="usage-pop">
        <template v-if="context">
          <div class="pop-section">Контекст</div>
          <div class="pop-row">
            <span>{{ tokens(context.used) }} / {{ tokens(context.size) }} токенов</span>
            <span class="pop-value">{{ context.percent }}% использовано</span>
          </div>
          <div class="bar"><span :class="tone(context.percent)" :style="{ width: context.percent + '%' }" /></div>
          <div v-if="cost" class="pop-note">Стоимость сессии ≈ {{ cost }} (по ценам API)</div>
        </template>

        <div class="pop-section">Лимиты подписки</div>
        <template v-if="windows.length">
          <div v-for="w in windows" :key="w.id" class="pop-limit">
            <div class="pop-row">
              <span>{{ w.label }}</span>
              <span class="pop-value" :class="tone(w.percent)">{{ w.percent >= 100 ? 'исчерпан' : `${w.percent}% использовано` }}</span>
            </div>
            <div class="bar"><span :class="tone(w.percent)" :style="{ width: w.percent + '%' }" /></div>
            <div v-if="w.resetsAt" class="pop-note">Сброс {{ resets(w.resetsAt) }}</div>
          </div>
        </template>
        <div v-else class="pop-note">{{ limits?.error || 'Загрузка…' }}</div>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useChatStore } from '../stores/sessions'

export interface UsageInfo { used: number; size: number; cost?: { amount: number; currency: string } | null }

/** Two rings: this chat's context window and the agent account's tightest subscription limit. */
const props = defineProps<{ agentId: string; usage?: UsageInfo | null }>()
const store = useChatStore()
const root = ref<HTMLElement>()
const open = ref(false)
const now = ref(Date.now())

const limits = computed(() => store.limits[props.agentId])
const windows = computed(() => limits.value?.windows ?? [])
const tightest = computed(() => [...windows.value].sort((a, b) => b.percent - a.percent)[0] ?? null)
const context = computed(() => {
  const u = props.usage
  return u?.size ? { used: u.used, size: u.size, percent: Math.min(100, Math.round((u.used / u.size) * 100)) } : null
})
const cost = computed(() => {
  const c = props.usage?.cost
  return c && c.amount > 0 ? new Intl.NumberFormat('ru-RU', { style: 'currency', currency: c.currency || 'USD', maximumFractionDigits: 2 }).format(c.amount) : ''
})

const dash = (percent: number) => `${Math.max(percent, 2) * 0.4712} 47.12` // 2πr for r = 7.5
const tone = (percent: number) => (percent >= 90 ? 'danger' : percent >= 75 ? 'warn' : '')
const short = (label: string) => label.replace('5 часов', '5ч').replace(/^Неделя/, 'Нед.')
const tokens = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}k` : String(n))
function resets(ms: number) {
  const minutes = Math.max(0, Math.round((ms - now.value) / 60_000))
  if (minutes < 60) return `через ${minutes} мин`
  if (minutes < 24 * 60) return `через ${Math.floor(minutes / 60)} ч ${minutes % 60} мин`
  return new Date(ms).toLocaleString('ru-RU', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

// Poll once a minute while this meter is actually on screen (hidden tabs use v-show).
function poll() {
  now.value = Date.now()
  const hidden = document.hidden || (root.value ? root.value.offsetParent === null : false)
  if (!hidden) void store.fetchLimits(props.agentId)
}
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => { poll(); timer = setInterval(poll, 60_000); document.addEventListener('visibilitychange', poll) })
onBeforeUnmount(() => { clearInterval(timer); document.removeEventListener('visibilitychange', poll) })
watch(() => props.agentId, poll)
</script>

<style scoped>
.usage { position: relative; display: inline-flex; }
.usage-trigger { display: inline-flex; align-items: center; gap: 10px; height: var(--size-sm); padding: 0 8px; background: none; border: none; border-radius: 8px; color: var(--text-muted); font: inherit; font-size: 12px; cursor: pointer; }
.usage-trigger:hover { background: var(--bg3); color: var(--text); }
.meter { display: inline-flex; align-items: center; gap: 5px; white-space: nowrap; }
.meter-text { font-variant-numeric: tabular-nums; }
.meter-label { color: var(--text-faint); }
.meter.warn .meter-text { color: var(--warning-text); }
.meter.danger .meter-text { color: var(--danger-hover); }
.ring { width: 16px; height: 16px; transform: rotate(-90deg); flex-shrink: 0; }
.ring-track, .ring-fill { fill: none; stroke-width: 2.5; }
.ring-track { stroke: var(--border-strong); }
.ring-fill { stroke: var(--blue-hover); stroke-linecap: round; transition: stroke-dasharray 0.3s; }
.warn .ring-fill { stroke: var(--warning-text); }
.danger .ring-fill { stroke: var(--danger-hover); }

.usage-pop { position: absolute; right: 0; bottom: calc(100% + 8px); width: 290px; padding: 4px 14px 12px; background: var(--bg2); border: 1px solid var(--border-strong); border-radius: var(--radius); box-shadow: var(--shadow-md); z-index: 50; font-size: 12.5px; }
.pop-section { margin: 10px 0 6px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-muted); }
.pop-section + .pop-row, .pop-section + .pop-limit { margin-top: 0; }
.pop-section:not(:first-child) { padding-top: 10px; border-top: 1px solid var(--border); }
.pop-row { display: flex; justify-content: space-between; gap: 8px; }
.pop-value { color: var(--text-muted); font-variant-numeric: tabular-nums; white-space: nowrap; }
.pop-value.warn { color: var(--warning-text); }
.pop-value.danger { color: var(--danger-hover); }
.pop-note { margin-top: 4px; font-size: 11.5px; color: var(--text-faint); }
.pop-limit + .pop-limit { margin-top: 10px; }
.bar { height: 5px; margin-top: 6px; border-radius: var(--radius-pill); background: var(--bg3); overflow: hidden; }
.bar span { display: block; height: 100%; border-radius: inherit; background: var(--blue-hover); transition: width 0.3s; }
.bar span.warn { background: var(--warning-text); }
.bar span.danger { background: var(--danger-hover); }
.pop-enter-active, .pop-leave-active { transition: opacity 0.12s, transform 0.12s; }
.pop-enter-from, .pop-leave-to { opacity: 0; transform: translateY(4px); }
</style>
