<template>
  <div class="rc" :class="[remark.status, { open: expanded, outdated: remark.outdated }]">
    <div class="rc-head" role="button" tabindex="0" :aria-expanded="expanded" @click="toggle" @keydown.enter.self.prevent="toggle" @keydown.space.self.prevent="toggle">
      <span class="rc-dot" :title="remark.author === 'agent' ? 'Замечание агента' : 'Ваше замечание'" />
      <span v-if="showLocation" class="rc-loc">{{ remarkPlace(remark) }}</span>
      <span v-if="remark.author === 'agent'" class="rc-flag">агент</span>
      <span v-if="!expanded" class="rc-summary" :class="{ below: showLocation }">{{ summary }}</span>
      <span class="rc-status" :class="stage">{{ statusText }}</span>
    </div>

    <div v-if="expanded" class="rc-body">
      <div v-if="remark.outdated" class="rc-warn">Строка из прошлой версии ветки.</div>
      <form v-if="editing" class="rc-edit" @submit.prevent="save" @keydown.esc.stop.prevent="editing = false">
        <AppTextarea ref="fieldComponent" v-model="text" block rows="4" spellcheck="false" @input="fit" @keydown.ctrl.enter.prevent="save" @keydown.meta.enter.prevent="save" />
        <div class="rc-actions">
          <span class="rc-spacer" />
          <AppButton variant="subtle" size="xs" type="button" @click="editing = false; text = ''">Отмена</AppButton>
          <AppButton variant="blue" size="xs" type="submit" :disabled="!text.trim() || busy">Сохранить</AppButton>
        </div>
      </form>
      <div v-else class="rc-msg">
        <div class="rc-msg-head">{{ remark.author === 'agent' ? 'Агент' : 'Вы' }} · замечание</div>
        <MessageMarkdown :text="remark.body" />
      </div>
      <details v-if="remark.original" class="rc-was">
        <summary>Текст изменён · посмотреть, что было</summary>
        <MessageMarkdown :text="remark.original" />
      </details>

      <AgentDiscussion
        v-if="live" :screen-key="screenKey" :scope="scope" :review-id="reviewId" :remark-id="remark.id" :where="where" :place="remark" @queued="open = false"
        placeholder="Что в этом замечании непонятно или с чем вы не согласны? Написанное встанет в очередь и уйдёт агенту вместе с остальным. Ctrl+Enter — в очередь"
        hint="Спросить агента о замечании: можно уточнить или поспорить, по итогу агент перепишет замечание"
      />

      <div v-if="!editing" class="rc-actions">
        <AppButton v-if="showLocation && remark.path" class="rc-act" variant="ghost" size="xs" type="button" @click="emit('goto', remark)"><IconCode />К коду</AppButton>
        <span class="rc-spacer" />
        <template v-if="live">
          <AppButton v-if="remark.outdated" class="rc-act" variant="ghost" size="xs" type="button" :disabled="busy" title="Сделать замечанием к МР целиком с указанием места" @click="run(() => branchReviewApi.detachRemark(scope, reviewId, remark.id))">Сделать общим</AppButton>
          <AppButton class="rc-act" variant="danger-ghost" size="xs" type="button" :disabled="busy" title="Не публиковать: замечание останется в «Отклонённых»" @click="reject">Отклонить</AppButton>
          <AppButton class="rc-act" variant="ghost" size="xs" type="button" :disabled="busy" @click="startEdit">Править</AppButton>
        </template>
        <template v-else-if="remark.status === 'rejected'">
          <AppButton class="rc-act" variant="danger-ghost" size="xs" type="button" :disabled="busy" title="Удалить совсем" @click="removeRemark">Удалить</AppButton>
          <AppButton class="rc-act" variant="ghost" size="xs" type="button" :disabled="busy" title="Вернуть в черновики: замечание снова будет опубликовано" @click="run(() => branchReviewApi.rejectRemark(scope, reviewId, remark.id, false))">Вернуть</AppButton>
        </template>
      </div>
      <div v-if="remark.status === 'uncertain'" class="rc-uncertain">
        <span>{{ remark.error || 'Проверьте в GitLab, дошло ли замечание.' }}</span>
        <AppButton variant="link" size="xs" type="button" :disabled="busy" @click="run(() => branchReviewApi.recoverRemark(scope, reviewId, remark.id, true))">Есть в GitLab</AppButton>
        <AppButton variant="link" size="xs" type="button" :disabled="busy" @click="run(() => branchReviewApi.recoverRemark(scope, reviewId, remark.id, false))">Нет, вернуть в черновики</AppButton>
      </div>
      <div v-else-if="remark.error" class="rc-error">{{ remark.error }}</div>
    </div>
  </div>
</template>
<script setup lang="ts">
import { IconCode } from '@shared/ui/icons'
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
import { useDiscussion } from '../composables/useDiscussion'
import { remarkPlace } from '../utils'
import AgentDiscussion from './AgentDiscussion.vue'

/**
 * A remark of the review: a draft until it is published to the merge request. The developer can talk it over with the agent
 * (the conversation sits in the card and may end in a rewritten text), edit it or reject it: a rejected remark is kept but never published.
 */
/** `where` tells the copies of one remark apart (under the line of the diff, in the panel): what is typed in one is not typed in the other. */
const props = withDefaults(defineProps<{ remark: Remark; screenKey: string; scope: string; reviewId: string; showLocation?: boolean; where?: string }>(), { where: 'panel' })
const emit = defineEmits<{ goto: [remark: Remark] }>()
const screen = useBranchReviewStore().of(props.screenKey)
const app = useAppStore()
const { stage } = useDiscussion(props.screenKey, () => ({ remarkId: props.remark.id }))
/** null: the card decides (it opens by itself when something needs the developer); a click on its head decides for good. */
const open = ref<boolean | null>(null)
const busy = ref(false), editing = useDraft(() => `branch-review:${props.reviewId}:remark:${props.remark.id}:${props.where}:editing`, () => false), text = useDraft(() => `branch-review:${props.reviewId}:remark:${props.remark.id}:${props.where}:text`, () => '')
const fieldComponent = ref<InstanceType<typeof AppTextarea>>()
/** A draft the developer has not rejected: it can be discussed, edited and published. */
const live = computed(() => props.remark.status === 'draft')
/** Collapsed to the text of the remark; open it to talk it over, collapse it to hide the conversation. An unseen answer or trouble with publishing opens it, editing keeps it open. */
const attention = computed(() => stage.value === 'queued' || stage.value === 'answered' || props.remark.status === 'uncertain' || !!props.remark.error)
const expanded = computed(() => editing.value || (open.value ?? attention.value))
const toggle = () => { if (!editing.value) open.value = !expanded.value }
const summary = computed(() => props.remark.body.replace(/\s+/g, ' ').trim())
const statusText = computed(() => {
  if (props.remark.outdated) return 'устарело'
  if (props.remark.status === 'draft') return ({ '': 'черновик', queued: 'в очереди', waiting: 'ждёт агента', answered: 'агент ответил' } as Record<string, string>)[stage.value]
  return ({ sent: 'отправлено', uncertain: 'проверьте', rejected: 'отклонено' } as Record<string, string>)[props.remark.status] ?? ''
})
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
/** A rejected remark is done with: the card folds. */
async function reject() { if (await run(() => branchReviewApi.rejectRemark(props.scope, props.reviewId, props.remark.id, true))) open.value = false }
async function removeRemark() {
  if (!await app.confirm('Удалить отклонённое замечание совсем?', { confirmLabel: 'Удалить', danger: true })) return
  if (await run(() => branchReviewApi.removeRemark(props.scope, props.reviewId, props.remark.id))) useDraftsStore().clearPrefix(`branch-review:${props.reviewId}:remark:${props.remark.id}:`)
}
function startEdit() { text.value = props.remark.body; editing.value = true; void nextTick(fit) }
async function save() {
  if (!text.value.trim()) return
  if (await run(() => branchReviewApi.editRemark(props.scope, props.reviewId, props.remark.id, { body: text.value }))) { editing.value = false; text.value = ''; open.value = false }
}
</script>
<style scoped>
.rc { container-type: inline-size; border: 1px solid var(--border-strong); border-left-width: 3px; border-radius: var(--radius-sm); background: var(--bg2); font-size: var(--fs-sm); }
.rc.sent { border-left-color: var(--accent-hover); opacity: 0.75; }
.rc.uncertain { border-left-color: var(--warning-text); }
.rc.rejected { border-left-color: var(--danger-hover); opacity: 0.75; }
.rc.outdated { border-style: dashed; }
.rc-head { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 2px 6px; padding: 5px 8px; cursor: pointer; outline: none; }
.rc-head:hover { background: var(--bg3); }
.rc-head:focus-visible { outline: var(--focus-outline); outline-offset: -2px; }
.rc-dot { width: 7px; height: 7px; flex-shrink: 0; margin-top: 6px; border-radius: var(--radius-round); background: var(--text-faint); }
.rc-loc { flex: 1 1 0; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; line-height: var(--lh-normal); color: var(--text-muted); }
.rc-flag { flex-shrink: 0; margin-right: 2px; padding: 1px 8px; line-height: var(--lh-normal); font-size: var(--fs-xs); font-weight: var(--fw-medium); border: 1px solid var(--blue); border-radius: var(--radius-pill); background: transparent; color: var(--blue-hover); }
.rc-summary { flex: 1 1 0; min-width: 0; overflow: hidden; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; line-height: var(--lh-normal); color: var(--text); overflow-wrap: anywhere; }
.rc-summary.below { flex-basis: 100%; order: 2; }
.rc-status { flex-shrink: 0; margin-left: auto; line-height: var(--lh-normal); font-size: var(--fs-xs); color: var(--text-muted); white-space: nowrap; }
.rc-status.queued, .rc-status.answered { color: var(--warning-text); font-weight: var(--fw-semibold); }
.rc-body { display: flex; flex-direction: column; gap: 6px; padding: 2px 10px 8px; white-space: normal; }
.rc-msg { padding: 5px 8px; border-radius: var(--radius-sm); background: var(--bg); border-left: 2px solid var(--text-faint); line-height: 1.5; }
.rc-msg-head { margin-bottom: 2px; font-size: var(--fs-xs); font-weight: var(--fw-semibold); color: var(--text-muted); }
.rc-was { font-size: var(--fs-xs); color: var(--text-muted); }
.rc-was > :not(summary) { margin-top: 4px; padding-left: 8px; border-left: 2px solid var(--border); }
.rc-warn, .rc-uncertain { display: flex; flex-wrap: wrap; gap: 8px; color: var(--warning-text); }
.rc-error { color: var(--danger-hover); overflow-wrap: anywhere; }
.rc-edit { display: flex; flex-direction: column; gap: 6px; }
.rc-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; }
.rc-spacer { flex: 1; }
.rc-act { min-width: 76px; }
</style>
