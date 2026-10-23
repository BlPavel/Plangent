<template>
  <div class="rc" :class="[remark.status, { agent: remark.author === 'agent', outdated: remark.outdated }]">
    <div class="rc-head">
      <span class="rc-badge" :class="remark.author" :title="remark.author === 'agent' ? 'Черновик агента: правьте или уберите' : 'Ваше замечание'">{{ remark.author === 'agent' ? 'агент' : 'я' }}</span>
      <button v-if="showLocation" type="button" class="rc-link" :disabled="!remark.path" @click="emit('goto', remark)">{{ remarkPlace(remark) }}</button>
      <span v-if="remark.outdated" class="rc-warn" title="Строка из прошлой версии ветки">к старой версии</span>
      <span v-if="remark.status === 'sent'" class="rc-muted">отправлено</span>
      <span class="rc-spacer" />
      <template v-if="remark.status === 'draft' && !editing">
        <button v-if="remark.outdated" type="button" class="rc-link" :disabled="busy" title="Сделать замечанием к МР целиком с указанием места" @click="run(() => branchReviewApi.detachRemark(scope, reviewId, remark.id))">Сделать общим</button>
        <button type="button" class="rc-link" :disabled="busy" @click="startEdit">Править</button>
        <button type="button" class="rc-link rc-danger" :disabled="busy" @click="run(() => branchReviewApi.removeRemark(scope, reviewId, remark.id))">Убрать</button>
      </template>
    </div>
    <form v-if="editing" class="rc-edit" @submit.prevent="save" @keydown.esc.stop.prevent="editing = false">
      <textarea ref="field" v-model="text" class="control rc-text" rows="4" spellcheck="false" @input="fit" @keydown.ctrl.enter.prevent="save" @keydown.meta.enter.prevent="save" />
      <div class="rc-bar">
        <span class="rc-spacer" />
        <button type="button" class="btn btn-subtle btn-xs" @click="editing = false">Отмена</button>
        <button class="btn btn-blue btn-xs" :disabled="!text.trim() || busy">Сохранить</button>
      </div>
    </form>
    <MessageMarkdown v-else class="rc-body" :text="remark.body" />
    <div v-if="remark.status === 'uncertain'" class="rc-uncertain">
      <span>{{ remark.error || 'Проверьте в GitLab, дошло ли замечание.' }}</span>
      <button type="button" class="rc-link" :disabled="busy" @click="run(() => branchReviewApi.recoverRemark(scope, reviewId, remark.id, true))">Есть в GitLab</button>
      <button type="button" class="rc-link" :disabled="busy" @click="run(() => branchReviewApi.recoverRemark(scope, reviewId, remark.id, false))">Нет, вернуть в черновики</button>
    </div>
    <div v-else-if="remark.error" class="rc-error">{{ remark.error }}</div>
  </div>
</template>
<script setup lang="ts">
import { nextTick, ref } from 'vue'
import { useAppStore } from '@core/stores/app'
import MessageMarkdown from '@shared/ui/MessageMarkdown.vue'
import { errorText } from '@shared/utils/errorText'
import { branchReviewApi } from '../api'
import type { Remark, Remarks } from '../types'
import { useBranchReviewStore } from '../stores/review'
import { remarkPlace } from '../utils'

/** A draft (or sent) remark for the merge request; the agent's drafts are edited the same way as the developer's. */
const props = defineProps<{ remark: Remark; screenKey: string; scope: string; reviewId: string; showLocation?: boolean }>()
const emit = defineEmits<{ goto: [remark: Remark] }>()
const screen = useBranchReviewStore().of(props.screenKey)
const app = useAppStore()
const busy = ref(false), editing = ref(false), text = ref('')
const field = ref<HTMLTextAreaElement>()
/** The field opens as tall as the text, up to a limit; longer text scrolls. */
function fit() {
  const el = field.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = Math.min(el.scrollHeight + 2, 360) + 'px'
}

async function run(action: () => Promise<Remarks>) {
  busy.value = true
  try { screen.remarks = (await action()).remarks; return true }
  catch (cause) { app.toast(errorText(cause), 'error'); return false }
  finally { busy.value = false }
}
function startEdit() { text.value = props.remark.body; editing.value = true; void nextTick(fit) }
async function save() {
  if (!text.value.trim()) return
  if (await run(() => branchReviewApi.editRemark(props.scope, props.reviewId, props.remark.id, { body: text.value }))) editing.value = false
}
</script>
<style scoped>
.rc { display: flex; flex-direction: column; gap: 4px; padding: 6px 8px; font-size: 12px; background: var(--bg2); border: 1px solid var(--border-strong); border-left: 3px solid var(--blue); border-radius: var(--radius-sm); }
.rc.agent { border-left-color: var(--warning-text); }
.rc.sent { opacity: 0.75; border-left-color: var(--accent-hover); }
.rc-head { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.rc-badge { padding: 0 6px; font-size: 10px; font-weight: 600; border-radius: var(--radius-pill); background: var(--blue-soft); color: var(--blue-hover); }
.rc-badge.agent { background: var(--warning-soft); color: var(--warning-text); }
.rc-warn { font-size: 11px; color: var(--warning-text); }
.rc-muted { font-size: 11px; color: var(--text-muted); }
.rc-spacer { flex: 1; }
.rc-link { padding: 0; font: inherit; font-size: 11.5px; color: var(--blue-hover); background: none; border: none; cursor: pointer; text-align: left; overflow-wrap: anywhere; }
.rc-link:disabled { color: var(--text-muted); cursor: default; }
.rc-danger { color: var(--danger-hover); }
.rc-body { font-size: 12.5px; line-height: 1.5; }
.rc-edit { display: flex; flex-direction: column; gap: 6px; }
.rc-text { width: 100%; padding: 6px 10px; line-height: 1.45; resize: vertical; font: inherit; }
.rc-bar { display: flex; align-items: center; gap: 6px; }
.rc-uncertain { display: flex; flex-wrap: wrap; gap: 8px; color: var(--warning-text); }
.rc-error { color: var(--danger-hover); overflow-wrap: anywhere; }
</style>
