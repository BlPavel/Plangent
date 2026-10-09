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
          <span v-if="draft.status==='sent'" class="status-badge done">Отправлено</span>
          <span v-else-if="draft.status==='uncertain'" class="status-badge danger">Неизвестно</span>
          <span v-else-if="draft.position && draft.position.head_sha!==head" class="status-badge progress" title="Черновик написан к другой версии МР">другая версия</span>
        </div>
        <template v-if="draft.status==='draft'">
          <textarea v-model="edits[draft.id]" class="control" aria-label="Текст черновика" :disabled="busy" rows="3" @keydown.enter.ctrl.exact.prevent="save(draft.id)" @keydown.enter.meta.exact.prevent="save(draft.id)" />
          <div class="draft-actions">
            <button type="button" class="btn btn-danger-ghost btn-xs" :disabled="busy" @click="confirmRemove(draft.id)">Удалить</button>
            <span class="dp-spacer" />
            <button v-if="edits[draft.id]!==draft.body" type="button" class="btn btn-ghost btn-xs" :disabled="busy || !edits[draft.id]?.trim()" @click="save(draft.id)">Сохранить правку</button>
            <button type="button" class="btn btn-subtle btn-xs" :disabled="busy || dirty || !!draft.position && draft.position.head_sha!==head" title="Опубликовать только это замечание" @click="confirmPublish([draft.id])">Опубликовать</button>
          </div>
        </template>
        <p v-else class="draft-body">{{ draft.body }}</p>
        <template v-if="draft.status==='uncertain'">
          <p role="alert" class="draft-warn">Результат отправки неизвестен. Проверьте замечание в GitLab.</p>
          <div class="draft-actions">
            <button type="button" class="btn btn-ghost btn-xs" :disabled="busy" @click="confirmRecovery(draft.id,true)">Проверено: опубликовано</button>
            <button type="button" class="btn btn-ghost btn-xs" :disabled="busy" @click="confirmRecovery(draft.id,false)">Проверено: не отправлено</button>
          </div>
        </template>
        <p v-if="draft.error" role="alert" class="draft-error">{{ draft.error }}</p>
      </article>
    </div>
    <div class="dp-foot">
      <p v-if="dirty" class="dp-hint">Сохраните правки перед публикацией.</p>
      <p v-else-if="outdated" class="dp-hint">Перенесите черновики другой версии на актуальные строки.</p>
      <button type="button" class="btn btn-blue btn-sm" :disabled="busy || !pending.length || dirty || outdated" @click="confirmPublish(pending.map(d=>d.id))">Опубликовать ревью</button>
    </div>
  </aside>
</template>
<script setup lang="ts">
import { computed, reactive, watch } from 'vue';
import { useAppStore } from '@core/stores/app';
import type { MrDraft } from '../types';
const props = defineProps<{
  drafts: MrDraft[];
  head: string;
  busy: boolean;
  publish: (ids: string[]) => Promise<unknown>;
  edit: (id: string, body: string) => Promise<unknown>;
  remove: (id: string) => Promise<unknown>;
  recover: (id: string, published: boolean) => Promise<unknown>;
}>();
const app = useAppStore(), edits = reactive<Record<string, string>>({});
watch(() => props.drafts, rows => {
  for (const d of rows)
    if (edits[d.id] === undefined)
      edits[d.id] = d.body;
}, { immediate: true });
const pending = computed(() => props.drafts.filter(d => d.status === 'draft'));
const dirty = computed(() => pending.value.some(d => edits[d.id] !== d.body));
const outdated = computed(() => pending.value.some(d => d.position && d.position.head_sha !== props.head));
async function confirmRecovery(id: string, published: boolean) {
  if (await app.confirm(published ? 'Вы проверили в GitLab, что замечание опубликовано?' : 'Вы проверили в GitLab, что замечание не отправлено?', { confirmLabel: 'Подтвердить проверку' }))
    await props.recover(id, published);
}
async function save(id: string) {
  if (props.busy || !edits[id]?.trim() || edits[id] === props.drafts.find(d => d.id === id)?.body)
    return;
  await props.edit(id, edits[id] ?? '');
}
async function confirmRemove(id: string) {
  if (await app.confirm('Удалить черновик замечания?', { confirmLabel: 'Удалить', danger: true }))
    await props.remove(id);
}
async function confirmPublish(ids: string[]) {
  if (await app.confirm('Опубликовать замечания в GitLab: ' + ids.length + '? Они станут видны участникам МР.', { confirmLabel: 'Опубликовать' }))
    await props.publish(ids);
}
</script>
<style scoped>
.draft-panel { width: 310px; min-width: 240px; flex-shrink: 0; display: flex; flex-direction: column; min-height: 0; border-left: 1px solid var(--border); font-size: 12px; }
.dp-head { display: flex; align-items: center; gap: 6px; padding: 8px 12px; border-bottom: 1px solid var(--border); }
.dp-title { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); }
.dp-count { padding: 0 6px; font-size: 10px; font-weight: 600; border-radius: var(--radius-pill); background: var(--blue); color: #fff; }
.dp-list { flex: 1; min-height: 0; overflow: auto; padding: 8px 12px; display: flex; flex-direction: column; gap: 8px; }
.dp-empty { padding: 16px 4px; text-align: center; line-height: 1.5; color: var(--text-muted); }
.draft { display: flex; flex-direction: column; gap: 6px; padding: 8px; border: 1px solid var(--border); border-left: 3px solid var(--blue); border-radius: var(--radius-sm); background: var(--bg2); }
.draft.sent { border-left-color: var(--accent); opacity: .8; }
.draft.uncertain { border-left-color: var(--danger); }
.draft-where { display: flex; align-items: center; gap: 6px; }
.draft-path { flex: 1; min-width: 0; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.draft textarea { width: 100%; height: auto; padding: 6px 8px; resize: vertical; line-height: 1.45; font-size: 12px; }
.draft-actions { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
.dp-spacer { flex: 1; }
.draft-body { white-space: pre-wrap; overflow-wrap: anywhere; }
.draft-warn { color: var(--warning-text); }
.draft-error { color: var(--danger-hover); overflow-wrap: anywhere; }
.dp-foot { display: flex; flex-direction: column; gap: 6px; padding: 10px 12px; border-top: 1px solid var(--border); }
.dp-foot .btn { width: 100%; }
.dp-hint { font-size: 11.5px; color: var(--warning-text); }
</style>
