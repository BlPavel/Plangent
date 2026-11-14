<template>
  <section class="id-hint" :aria-label="'Номера ' + T.plural">
    <div class="id-hint-row">
      <span class="id-token" aria-hidden="true">**{{ prefix }}1**</span>
      <p class="id-hint-lead">{{ T.lead }}</p>
      <div class="id-hint-ids">
        <span class="id-hint-label">В тексте:</span>
        <AppButton v-for="id in ids" :key="id" size="xs" variant="subtle" :title="'Скопировать ссылку ' + link(id)" @click="copy(id)">{{ id }}</AppButton>
        <span v-if="!ids.length" class="id-hint-none">пока нет</span>
        <AppButton size="xs" variant="blue" :title="'Вставить ' + next + ' в позицию курсора'" @click="$emit('insert', next)">+ {{ next }}</AppButton>
      </div>
      <AppButton size="xs" variant="ghost" :pressed="open" :aria-expanded="open" @click="toggle">{{ open ? 'Скрыть правила' : 'Правила' }}</AppButton>
    </div>
    <dl v-if="open" class="id-hint-rules">
      <div class="id-rule">
        <dt>Как пометить</dt>
        <dd><code>**{{ prefix }}1**</code> в начале строки или заголовка: <code>### **{{ prefix }}1** Название</code></dd>
      </div>
      <div class="id-rule">
        <dt>Как сослаться</dt>
        <dd><code>{{ link(prefix + '1') }}</code> — {{ T.one }}, <code>[[{{ type }}]]</code> — весь документ. На раздел без номера сослаться нельзя.</dd>
      </div>
      <div class="id-rule">
        <dt>Что входит</dt>
        <dd>Текст от номера до следующего номера или заголовка, вместе со схемами.</dd>
      </div>
      <div class="id-rule id-rule-warn">
        <dt>Не менять</dt>
        <dd>Номера не перенумеровывают и не используют повторно: на них уже ссылаются план и замечания. В блоках кода номера не считаются.</dd>
      </div>
    </dl>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import type { MaterialType } from '@contracts'
import AppButton from '@shared/ui/AppButton.vue'
import { platform } from '@core/platform'
import { useAppStore } from '@core/stores/app'
import { materialIdentifiers } from '../utils/document-target'

/** How decisions and criteria get a stable number that the plan, reviews and other documents link to. */
const props = defineProps<{ type: MaterialType; content: string; saved: string }>()
defineEmits<{ insert: [id: string] }>()

const texts = {
  architecture: { plural: 'решений', one: 'одно решение', lead: 'Решение с номером — на него ссылаются план, ревью и проверка кода.' },
  qa: { plural: 'критериев', one: 'один критерий', lead: 'Критерий с номером — на него ссылаются шаги плана, ревью и проверка кода.' },
}
const T = computed(() => texts[props.type])
const prefix = computed(() => props.type === 'architecture' ? 'D' : 'Q')
const ids = computed(() => materialIdentifiers(props.content).filter(id => id.startsWith(prefix.value)))
// A number removed from the draft is still referenced from the saved document, so it is never handed out again.
const next = computed(() => {
  const used = [...ids.value, ...materialIdentifiers(props.saved)].filter(id => id.startsWith(prefix.value)).map(id => Number(id.slice(1)))
  return prefix.value + (Math.max(0, ...used) + 1)
})
const link = (id: string) => `[[${props.type}#${id}]]`

const STORAGE_KEY = 'plangent.material.identifierHint'
const open = ref(readOpen())
function readOpen() {
  try { return localStorage.getItem(STORAGE_KEY) === 'open' } catch { return false }
}
function toggle() {
  open.value = !open.value
  try { localStorage.setItem(STORAGE_KEY, open.value ? 'open' : 'closed') } catch { /* storage unavailable */ }
}
const app = useAppStore()
async function copy(id: string) {
  await platform.setClipboardText(link(id))
  app.toast('Ссылка ' + link(id) + ' скопирована', 'success')
}
</script>

<style scoped>
.id-hint { flex-shrink: 0; margin: var(--sp-3) 20px var(--sp-4); border: 1px solid var(--border); border-left: 3px solid var(--blue-hover); border-radius: var(--radius-sm); background: var(--bg2); }
.id-hint-row { display: flex; align-items: center; flex-wrap: wrap; gap: var(--sp-2) var(--sp-3); padding: var(--sp-2) var(--sp-3); }
.id-token { flex-shrink: 0; padding: 2px var(--sp-2); border-radius: var(--radius-sm); background: var(--blue-soft); color: var(--blue-hover); font-family: var(--font-mono); font-size: var(--fs-sm); font-weight: var(--fw-semibold); }
.id-hint-lead { flex: 1 1 260px; min-width: 0; font-size: var(--fs-md); color: var(--text); }
.id-hint-ids { display: flex; align-items: center; flex-wrap: wrap; gap: var(--sp-1); }
.id-hint-label, .id-hint-none { font-size: var(--fs-sm); color: var(--text-muted); }
.id-hint-none { color: var(--text-faint); }
.id-hint-rules { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: var(--sp-1); padding: 0 var(--sp-2) var(--sp-2); }
.id-rule { padding: var(--sp-1) var(--sp-2); border-radius: var(--radius-sm); background: var(--bg); }
.id-rule dt { font-size: var(--fs-xs); font-weight: var(--fw-semibold); text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-muted); }
.id-rule dd { font-size: var(--fs-xs); line-height: var(--lh-normal); color: var(--text-muted); }
.id-rule-warn dt { color: var(--warning-text); }
.id-rule code { font-family: var(--font-mono); font-size: var(--fs-xs); padding: 0 var(--sp-1); border-radius: var(--radius-xs); background: var(--bg3); white-space: nowrap; }
</style>
