<template>
  <div class="rc" :class="[remark.status, { agent: remark.author === 'agent', outdated: remark.outdated }]">
    <div class="rc-head">
      <AppBadge  :tone="remark.author" :title="remark.author === 'agent' ? 'Черновик агента: правьте или уберите' : 'Ваше замечание'">{{ remark.author === 'agent' ? 'агент' : 'я' }}</AppBadge>
      <AppButton variant="link" size="md" v-if="showLocation" type="button"  :disabled="!remark.path" @click="emit('goto', remark)">{{ remarkPlace(remark) }}</AppButton>
      <span v-if="remark.outdated" class="rc-warn" title="Строка из прошлой версии ветки">к старой версии</span>
      <span v-if="remark.status === 'sent'" class="rc-muted">отправлено</span>
      <span class="rc-spacer" />
      <template v-if="remark.status === 'draft' && !editing">
        <AppButton variant="link" size="md" v-if="remark.outdated" type="button"  :disabled="busy" title="Сделать замечанием к МР целиком с указанием места" @click="run(() => branchReviewApi.detachRemark(scope, reviewId, remark.id))">Сделать общим</AppButton>
        <AppButton variant="link" size="md" type="button"  :disabled="busy" @click="startEdit">Править</AppButton>
        <AppButton variant="danger-link" size="md" type="button" :disabled="busy" @click="removeRemark">Убрать</AppButton>
      </template>
    </div>
    <form v-if="editing" class="rc-edit" @submit.prevent="save" @keydown.esc.stop.prevent="editing = false">
      <AppTextarea ref="fieldComponent" v-model="text" block rows="4" spellcheck="false" @input="fit" @keydown.ctrl.enter.prevent="save" @keydown.meta.enter.prevent="save" />
      <div class="rc-bar">
        <span class="rc-spacer" />
        <AppButton variant="subtle" size="xs" type="button"  @click="editing = false; text = ''">Отмена</AppButton>
        <AppButton variant="blue" size="xs" type="submit" :disabled="!text.trim() || busy">Сохранить</AppButton>
      </div>
    </form>
    <MessageMarkdown v-else class="rc-body" :text="remark.body" />
    <div v-if="remark.status === 'uncertain'" class="rc-uncertain">
      <span>{{ remark.error || 'Проверьте в GitLab, дошло ли замечание.' }}</span>
      <AppButton variant="link" size="md" type="button"  :disabled="busy" @click="run(() => branchReviewApi.recoverRemark(scope, reviewId, remark.id, true))">Есть в GitLab</AppButton>
      <AppButton variant="link" size="md" type="button"  :disabled="busy" @click="run(() => branchReviewApi.recoverRemark(scope, reviewId, remark.id, false))">Нет, вернуть в черновики</AppButton>
    </div>
    <div v-else-if="remark.error" class="rc-error">{{ remark.error }}</div>
  </div>
</template>
<script setup lang="ts">
import AppBadge from '@shared/ui/AppBadge.vue'
import AppButton from '@shared/ui/AppButton.vue'
import AppTextarea from '@shared/ui/AppTextarea.vue'
import { useDraftsStore } from '@core/stores/drafts'
import { useDraft } from '@core/composables/useDraft'
import { computed, nextTick, ref } from 'vue'
import { useAppStore } from '@core/stores/app'
import { MessageMarkdown } from '@shared/markdown'
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
const busy = ref(false), editing = useDraft(() => `branch-review:${props.reviewId}:remark:${props.remark.id}:editing`, () => false), text = useDraft(() => `branch-review:${props.reviewId}:remark:${props.remark.id}:text`, () => '')
const fieldComponent = ref<InstanceType<typeof AppTextarea>>()
const field = computed(() => fieldComponent.value?.element)
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
async function removeRemark() { if (await run(() => branchReviewApi.removeRemark(props.scope, props.reviewId, props.remark.id))) useDraftsStore().clearPrefix(`branch-review:${props.reviewId}:remark:${props.remark.id}:`) }
function startEdit() { text.value = props.remark.body; editing.value = true; void nextTick(fit) }
async function save() {
  if (!text.value.trim()) return
  if (await run(() => branchReviewApi.editRemark(props.scope, props.reviewId, props.remark.id, { body: text.value }))) { editing.value = false; text.value = '' }
}
</script>
<style scoped>
.rc { display: flex; flex-direction: column; gap: 4px; padding: 6px 8px; font-size: var(--fs-sm); background: var(--bg2); border: 1px solid var(--border-strong); border-left: 3px solid var(--blue); border-radius: var(--radius-sm); }
.rc.agent { border-left-color: var(--warning-text); }
.rc.sent { opacity: 0.75; border-left-color: var(--accent-hover); }
.rc-head { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.rc-badge { padding: 0 6px; font-size: var(--fs-xs); font-weight: 600; border-radius: var(--radius-pill); background: var(--blue-soft); color: var(--blue-hover); }
.rc-badge.agent { background: var(--warning-soft); color: var(--warning-text); }
.rc-warn { font-size: var(--fs-xs); color: var(--warning-text); }
.rc-muted { font-size: var(--fs-xs); color: var(--text-muted); }
.rc-spacer { flex: 1; }
.rc-link { padding: 0; font: inherit; font-size: var(--fs-sm); color: var(--blue-hover); background: none; border: none; cursor: pointer; text-align: left; overflow-wrap: anywhere; }
.rc-link:disabled { color: var(--text-muted); cursor: default; }
.rc-body { font-size: var(--fs-md); line-height: 1.5; }
.rc-edit { display: flex; flex-direction: column; gap: 6px; }
.rc-text { width: 100%; padding: 6px 10px; line-height: 1.45; resize: vertical; font: inherit; }
.rc-bar { display: flex; align-items: center; gap: 6px; }
.rc-uncertain { display: flex; flex-wrap: wrap; gap: 8px; color: var(--warning-text); }
.rc-error { color: var(--danger-hover); overflow-wrap: anywhere; }
</style>
