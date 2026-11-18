<template>
  <div class="cft">
    <AppButton v-if="overflowing" variant="subtle" size="xs" icon class="cft-nav" :disabled="!canLeft" title="Прокрутить вкладки влево" aria-label="Прокрутить вкладки влево" @click="page(-1)">‹</AppButton>
    <div ref="viewport" class="cft-scroll" data-file-tabs-viewport @scroll="measure" @wheel="wheel">
      <AppTabs
        rich bare draggable @tab-dragstart="(path, event) => dragMention(event, path)" :model-value="active ?? ''" :items="files.map(file => ({ value: file.path, label: nameOf(file.path), title: file.path }))" label="Открытые файлы"
        @update:model-value="emit('select', $event)" @tab-middle="emit('close', $event)"
      >
        <template #item="{ item }">
          <!-- eslint-disable-next-line vue/no-v-html -- bundled icon set, not user input -->
          <span class="cft-icon" v-html="iconSvg(fileIconName(item.label))" />
          <span class="cft-name">{{ item.label }}</span>
          <span v-if="statuses[item.value]" class="cft-status" :class="'st-' + statusClass(statuses[item.value])">{{ statuses[item.value] }}</span>
          <AppButton variant="subtle" size="xs" icon tabindex="-1" title="Закрыть" :aria-label="'Закрыть ' + item.label" @click.stop="emit('close', item.value)" @mousedown.middle.stop>
            <UIIconClose />
          </AppButton>
        </template>
      </AppTabs>
    </div>
    <AppButton v-if="overflowing" variant="subtle" size="xs" icon class="cft-nav" :disabled="!canRight" title="Прокрутить вкладки вправо" aria-label="Прокрутить вкладки вправо" @click="page(1)">›</AppButton>
    <div class="cft-menu">
      <AppMenu :title="`Открытые файлы (${files.length})`" icon="chevron" :items="fileMenu" :min-width="280" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useMentionDrag } from '../composables/useMentionDrag'
import { IconClose as UIIconClose } from '@shared/ui/icons'
import AppButton from '@shared/ui/AppButton.vue'
import AppTabs from '@shared/ui/AppTabs.vue'
import AppMenu from '@shared/ui/AppMenu.vue'
import { fileIconName, iconSvg } from '@shared/code-viewer'


/** Tabs of the open files; `statuses` marks changed files by their git letter. */
const props = defineProps<{ files: { path: string }[]; active: string | null; statuses: Record<string, string> }>()
const dragMention = useMentionDrag()
const emit = defineEmits<{ select: [path: string]; close: [path: string]; 'close-all': [] }>()
const nameOf = (path: string) => path.slice(path.lastIndexOf('/') + 1)
const statusClass = (status: string) => (status === '?' ? 'A' : status === 'C' ? 'R' : status)
const fileMenu = computed(() => [
  ...props.files.map(file => ({
    label: (file.path === props.active ? '✓ ' : '') + nameOf(file.path),
    hint: file.path,
    action: () => emit('select', file.path),
  })),
  { separator: true },
  { label: 'Закрыть все файлы', action: () => emit('close-all') },
])

const viewport = ref<HTMLElement>()
const overflowing = ref(false), canLeft = ref(false), canRight = ref(false)
let observer: ResizeObserver | undefined
function measure() {
  const el = viewport.value
  if (!el) return
  overflowing.value = el.scrollWidth > el.clientWidth + 1
  canLeft.value = el.scrollLeft > 1
  canRight.value = el.scrollLeft + el.clientWidth < el.scrollWidth - 1
}
/** Scroll only this strip: scrollIntoView can also move the surrounding code screen. */
function revealActive() {
  const el = viewport.value
  if (!el) return
  const tab = Array.from(el.querySelectorAll<HTMLElement>('[role="tab"]')).find(item => item.dataset.id === props.active)
  if (tab) {
    const bounds = el.getBoundingClientRect(), rect = tab.getBoundingClientRect()
    if (rect.width > el.clientWidth || rect.left < bounds.left) el.scrollLeft += rect.left - bounds.left
    else if (rect.right > bounds.right) el.scrollLeft += rect.right - bounds.right
  }
  measure()
}
function page(direction: number) {
  const el = viewport.value
  if (!el) return
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  el.scrollBy({ left: direction * Math.max(1, el.clientWidth * 0.8), behavior: reduced ? 'auto' : 'smooth' })
}
function wheel(event: WheelEvent) {
  const el = viewport.value
  // Trackpads already supply horizontal scrolling; Ctrl+wheel belongs to browser zoom.
  if (!el || !overflowing.value || event.ctrlKey || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return
  event.preventDefault()
  const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? el.clientWidth : 1
  el.scrollLeft += event.deltaY * unit
  measure()
}
watch(() => [props.active, props.files.map(file => file.path)] as const, async () => {
  await nextTick()
  measure()
  // Overflow controls change the viewport width on their first appearance.
  await nextTick()
  revealActive()
}, { flush: 'post' })
onMounted(() => {
  if (typeof ResizeObserver !== 'undefined' && viewport.value) {
    observer = new ResizeObserver(() => { measure(); void nextTick(revealActive) })
    observer.observe(viewport.value)
    if (viewport.value.firstElementChild) observer.observe(viewport.value.firstElementChild)
  }
  measure()
  void nextTick(revealActive)
})
onBeforeUnmount(() => observer?.disconnect())
</script>

<style scoped>
.cft { display: flex; align-items: stretch; flex-shrink: 0; height: 34px; background: var(--bg2); border-bottom: 1px solid var(--border); }
.cft-scroll { flex: 1; min-width: 0; overflow-x: auto; overflow-y: hidden; scrollbar-width: none; }
.cft-icon { display: inline-flex; width: 16px; height: 16px; }
.cft-icon :deep(svg) { width: 16px; height: 16px; }
.cft-status { font-size: var(--fs-xs); font-weight: 600; }
.st-M, .st-R { color: var(--warning-text); }
.st-A { color: var(--accent-hover); }
.st-D, .st-U { color: var(--danger-hover); }
.cft-nav { align-self: center; flex-shrink: 0; }
.cft-menu { display: flex; align-items: center; flex-shrink: 0; margin-inline: var(--sp-1); }
</style>
