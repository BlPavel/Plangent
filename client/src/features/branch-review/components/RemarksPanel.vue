<template>
  <div class="rp">
    <div class="rp-actions">
      <AppButton size="xs" variant="ghost" :disabled="composing" title="Замечание не к строке, а ко всему МР: архитектура, подход, разбиение" @click="composing = true">+ К МР целиком</AppButton>
      <span class="rp-spacer" />
      <template v-if="mr">
        <AppButton size="xs" variant="blue" :disabled="!drafts.length || busy" :title="drafts.length ? 'Опубликовать черновики в GitLab одной пачкой' : 'Нет черновиков'" @click="publish">{{ busy ? 'Публикация…' : 'Опубликовать ' + drafts.length }}</AppButton>
      </template>
      <template v-else>
        <AppButton size="xs" variant="ghost" :disabled="!drafts.length" title="Скопировать черновики как markdown, чтобы вставить их на хостинге" @click="copy">Скопировать {{ drafts.length }}</AppButton>
        <AppButton size="xs" variant="subtle" :disabled="!drafts.length || busy" title="Вы опубликовали их сами: следующий круг начнётся отсюда" @click="markSent">Отправлены</AppButton>
      </template>
    </div>
    <p v-if="error" role="alert" class="rp-error">{{ error }}</p>
    <div class="rp-list">
      <form v-if="composing" class="rp-new" @submit.prevent="addGeneral" @keydown.esc.stop.prevent="composing = false">
        <div class="rp-new-head">Замечание к МР целиком</div>
        <textarea v-model="text" class="control rp-text" rows="4" placeholder="Текст уйдёт в МР общим комментарием. Ctrl+Enter — сохранить" spellcheck="false" @keydown.ctrl.enter.prevent="addGeneral" @keydown.meta.enter.prevent="addGeneral" />
        <div class="rp-bar">
          <span class="rp-spacer" />
          <button type="button" class="btn btn-subtle btn-xs" @click="composing = false">Отмена</button>
          <button class="btn btn-blue btn-xs" :disabled="!text.trim()">Сохранить</button>
        </div>
      </form>
      <div v-if="!screen.remarks.length && !composing" class="rp-empty">
        Выделите строку в diff и напишите замечание или попросите агента разобрать МР на вкладке «Обзор». Всё копится черновиками{{ mr ? ' и уходит в GitLab только по «Опубликовать»' : '' }}.
      </div>
      <template v-for="group in groups" :key="group.title">
        <div class="rp-group">{{ group.title }} <span class="rp-count">{{ group.items.length }}</span></div>
        <RemarkCard v-for="r in group.items" :key="r.id" :remark="r" :screen-key="screenKey" :scope="scope" :review-id="reviewId" :show-location="!!r.path" @goto="emit('goto', $event)" />
      </template>
      <details v-if="sent.length" class="rp-sent">
        <summary>Отправленные {{ sent.length }}</summary>
        <RemarkCard v-for="r in sent" :key="r.id" :remark="r" :screen-key="screenKey" :scope="scope" :review-id="reviewId" show-location @goto="emit('goto', $event)" />
      </details>
    </div>
  </div>
</template>
<script setup lang="ts">
import { computed, ref } from 'vue'
import { useAppStore } from '@core/stores/app'
import { platform } from '@core/platform'
import AppButton from '@shared/ui/AppButton.vue'
import { errorText } from '@shared/utils/errorText'
import { branchReviewApi } from '../api'
import type { Remark } from '../types'
import { useBranchReviewStore } from '../stores/review'
import { plural, remarksMarkdown } from '../utils'
import RemarkCard from './RemarkCard.vue'

/** The remarks of the review: drafts grouped by place, published in one batch. */
const props = defineProps<{ screenKey: string; scope: string; reviewId: string; mr: boolean }>()
const emit = defineEmits<{ goto: [remark: Remark] }>()
const screen = useBranchReviewStore().of(props.screenKey)
const app = useAppStore()
const busy = ref(false), error = ref(''), composing = ref(false), text = ref('')

const drafts = computed(() => screen.remarks.filter(r => r.status !== 'sent'))
const sent = computed(() => screen.remarks.filter(r => r.status === 'sent'))
const groups = computed(() => {
  const general = drafts.value.filter(r => !r.path)
  const files = [...new Set(drafts.value.filter(r => r.path).map(r => r.path))].sort()
  return [
    ...(general.length ? [{ title: 'К МР целиком', items: general }] : []),
    ...files.map(path => ({ title: path, items: drafts.value.filter(r => r.path === path).sort((a, b) => a.line - b.line) })),
  ]
})

async function addGeneral() {
  if (!text.value.trim()) return
  try {
    screen.remarks = (await branchReviewApi.addRemark(props.scope, props.reviewId, { body: text.value })).remarks
    text.value = ''; composing.value = false
  } catch (cause) { error.value = errorText(cause) }
}
async function publish() {
  const ready = drafts.value.filter(r => r.status === 'draft')
  if (!ready.length) return
  const agentOnes = ready.filter(r => r.author === 'agent').length
  const message = `Опубликовать ${ready.length} ${plural(ready.length, 'замечание', 'замечания', 'замечаний')} в GitLab от вашего имени?` + (agentOnes ? ` Из них от агента: ${agentOnes} — проверьте, что согласны с ними.` : '')
  if (!(await app.confirm(message, { confirmLabel: 'Опубликовать' }))) return
  busy.value = true; error.value = ''
  try {
    const result = await branchReviewApi.publish(props.scope, props.reviewId, ready.map(r => r.id))
    screen.remarks = result.remarks
    if (result.publication_error) error.value = result.publication_error
    else app.toast('Замечания опубликованы', 'success')
  } catch (cause) { error.value = errorText(cause) } finally { busy.value = false }
}
async function copy() {
  await platform.setClipboardText(remarksMarkdown(drafts.value))
  app.toast('Замечания скопированы', 'success')
}
async function markSent() {
  if (!(await app.confirm('Отметить черновики отправленными? Сделайте это, когда опубликуете их на хостинге.', { confirmLabel: 'Отметить' }))) return
  busy.value = true; error.value = ''
  try { screen.remarks = (await branchReviewApi.markSent(props.scope, props.reviewId, drafts.value.map(r => r.id))).remarks }
  catch (cause) { error.value = errorText(cause) } finally { busy.value = false }
}
</script>
<style scoped>
.rp { display: flex; flex-direction: column; min-height: 0; flex: 1; }
.rp-actions { display: flex; align-items: center; gap: 6px; padding: 8px 10px; flex-shrink: 0; }
.rp-spacer { flex: 1; }
.rp-error { padding: 6px 10px; color: var(--danger-hover); overflow-wrap: anywhere; }
.rp-list { flex: 1; min-height: 0; overflow: auto; display: flex; flex-direction: column; gap: 6px; padding: 0 10px 10px; }
.rp-empty { padding: 8px 2px; color: var(--text-muted); line-height: 1.45; }
.rp-group { margin-top: 6px; font-size: 11px; font-weight: 600; color: var(--text-muted); overflow-wrap: anywhere; }
.rp-count { font-weight: 400; }
.rp-new { display: flex; flex-direction: column; gap: 6px; padding: 8px; background: var(--bg2); border: 1px solid var(--blue); border-radius: var(--radius-sm); }
.rp-new-head { font-weight: 600; color: var(--text-muted); }
.rp-text { width: 100%; padding: 8px 10px; line-height: 1.45; resize: vertical; font: inherit; }
.rp-bar { display: flex; align-items: center; gap: 6px; }
.rp-sent { margin-top: 8px; }
.rp-sent summary { cursor: pointer; color: var(--text-muted); margin-bottom: 6px; }
.rp-sent > :deep(.rc) { margin-bottom: 6px; }
</style>
