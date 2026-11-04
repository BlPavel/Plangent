<template>
  <aside class="draft-panel">
    <div class="dp-head">
      <span class="dp-title">Черновики</span>
      <span v-if="pending.length" class="dp-count">{{ pending.length }}</span>
    </div>
    <div class="dp-list">
      <div v-if="!drafts.length" class="dp-empty">Выберите строку diff, чтобы написать замечание. Оно останется черновиком, пока вы не опубликуете ревью.</div>
      <article v-for="draft in drafts" :key="draft.id" class="draft" :class="draft.status">
        <div class="draft-where">
          <span class="draft-path">{{ draft.position ? draft.position.new_path+':'+(draft.position.new_line??draft.position.old_line) : 'Общее замечание' }}</span>
          <AppBadge dot tone="done" v-if="draft.status==='sent'" >Отправлено</AppBadge>
          <AppBadge dot tone="danger" v-else-if="draft.status==='uncertain'" >Неизвестно</AppBadge>
          <AppBadge dot tone="progress" v-else-if="draft.position && draft.position.head_sha!==head"  title="Черновик написан к другой версии МР">другая версия</AppBadge>
        </div>
        <template v-if="draft.status==='draft'">
          <AppTextarea block v-model="edits[draft.id]"  aria-label="Текст черновика" :disabled="busy" rows="3" @keydown.enter.ctrl.exact.prevent="save(draft.id)" @keydown.enter.meta.exact.prevent="save(draft.id)" />
          <div class="draft-actions">
            <AppButton variant="danger-ghost" size="xs" type="button"  :disabled="busy" @click="confirmRemove(draft.id)">Удалить</AppButton>
            <span class="dp-spacer" />
            <AppButton variant="ghost" size="xs" v-if="edits[draft.id]!==draft.body" type="button"  :disabled="busy || !edits[draft.id]?.trim()" @click="save(draft.id)">Сохранить правку</AppButton>
            <AppButton variant="subtle" size="xs" type="button"  :disabled="busy || dirty || !!draft.position && draft.position.head_sha!==head" title="Опубликовать только это замечание" @click="confirmPublish([draft.id])">Опубликовать</AppButton>
          </div>
        </template>
        <p v-else class="draft-body">{{ draft.body }}</p>
        <template v-if="draft.status==='uncertain'">
          <p role="alert" class="draft-warn">Результат отправки неизвестен. Проверьте замечание в GitLab.</p>
          <div class="draft-actions">
            <AppButton variant="ghost" size="xs" type="button"  :disabled="busy" @click="confirmRecovery(draft.id,true)">Проверено: опубликовано</AppButton>
            <AppButton variant="ghost" size="xs" type="button"  :disabled="busy" @click="confirmRecovery(draft.id,false)">Проверено: не отправлено</AppButton>
          </div>
        </template>
        <p v-if="draft.error" role="alert" class="draft-error">{{ draft.error }}</p>
      </article>
    </div>
    <div class="dp-foot">
      <p v-if="dirty" class="dp-hint">Сохраните правки перед публикацией.</p>
      <p v-else-if="outdated" class="dp-hint">Перенесите черновики другой версии на актуальные строки.</p>
      <AppButton variant="blue" size="sm" type="button"  :disabled="busy || !pending.length || dirty || outdated" @click="confirmPublish(pending.map(d=>d.id))">Опубликовать ревью</AppButton>
    </div>
  </aside>
</template>
<script setup lang="ts">
import AppBadge from '@shared/ui/AppBadge.vue'
import AppTextarea from '@shared/ui/AppTextarea.vue'
import AppButton from '@shared/ui/AppButton.vue'
import { useDraft } from '@core/composables/useDraft'
import { computed, watch } from 'vue';
import { useAppStore } from '@core/stores/app';
import type { MrDraft } from '../types';
const props = defineProps<{
  reviewId: string;
  drafts: MrDraft[];
  head: string;
  busy: boolean;
  publish: (ids: string[]) => Promise<unknown>;
  edit: (id: string, body: string) => Promise<unknown>;
  remove: (id: string) => Promise<unknown>;
  recover: (id: string, published: boolean) => Promise<unknown>;
}>();
const app = useAppStore(), editDraft = useDraft<Record<string, string>>(() => `mr-review:${props.reviewId}:edits`, () => ({}));
const edits = computed(() => editDraft.value)
watch(() => props.drafts, rows => {
  for (const d of rows)
    if (edits.value[d.id] === undefined)
      edits.value[d.id] = d.body;
}, { immediate: true });
const pending = computed(() => props.drafts.filter(d => d.status === 'draft'));
const dirty = computed(() => pending.value.some(d => edits.value[d.id] !== d.body));
const outdated = computed(() => pending.value.some(d => d.position && d.position.head_sha !== props.head));
async function confirmRecovery(id: string, published: boolean) {
  if (await app.confirm(published ? 'Вы проверили в GitLab, что замечание опубликовано?' : 'Вы проверили в GitLab, что замечание не отправлено?', { confirmLabel: 'Подтвердить проверку' }))
    await props.recover(id, published);
}
async function save(id: string) {
  if (props.busy || !edits.value[id]?.trim() || edits.value[id] === props.drafts.find(d => d.id === id)?.body)
    return;
  if (await props.edit(id, edits.value[id] ?? '')) edits.value[id] = props.drafts.find(d => d.id === id)?.body ?? '';
}
async function confirmRemove(id: string) {
  if (await app.confirm('Удалить черновик замечания?', { confirmLabel: 'Удалить', danger: true }))
    if (await props.remove(id)) delete edits.value[id];
}
async function confirmPublish(ids: string[]) {
  if (await app.confirm('Опубликовать замечания в GitLab: ' + ids.length + '? Они станут видны участникам МР.', { confirmLabel: 'Опубликовать' }))
    await props.publish(ids);
}
</script>
<style scoped>
.draft-panel { width: 310px; min-width: 240px; flex-shrink: 0; display: flex; flex-direction: column; min-height: 0; border-left: 1px solid var(--border); font-size: var(--fs-sm); }
.dp-head { display: flex; align-items: center; gap: 6px; padding: 8px 12px; border-bottom: 1px solid var(--border); }
.dp-title { font-size: var(--fs-xs); font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); }
.dp-count { padding: 0 6px; font-size: var(--fs-xs); font-weight: 600; border-radius: var(--radius-pill); background: var(--blue); color: var(--on-accent); }
.dp-list { flex: 1; min-height: 0; overflow: auto; padding: 8px 12px; display: flex; flex-direction: column; gap: 8px; }
.dp-empty { padding: 16px 4px; text-align: center; line-height: 1.5; color: var(--text-muted); }
.draft { display: flex; flex-direction: column; gap: 6px; padding: 8px; border: 1px solid var(--border); border-left: 3px solid var(--blue); border-radius: var(--radius-sm); background: var(--bg2); }
.draft.sent { border-left-color: var(--accent); opacity: .8; }
.draft.uncertain { border-left-color: var(--danger); }
.draft-where { display: flex; align-items: center; gap: 6px; }
.draft-path { flex: 1; min-width: 0; font-family: var(--font-mono); font-size: var(--fs-xs); color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.draft-actions { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
.dp-spacer { flex: 1; }
.draft-body { white-space: pre-wrap; overflow-wrap: anywhere; }
.draft-warn { color: var(--warning-text); }
.draft-error { color: var(--danger-hover); overflow-wrap: anywhere; }
.dp-foot { display: flex; flex-direction: column; gap: 6px; padding: 10px 12px; border-top: 1px solid var(--border); }
.dp-foot .btn { width: 100%; }
.dp-hint { font-size: var(--fs-sm); color: var(--warning-text); }
</style>
