<template>
  <section class="review-tab" :aria-busy="busy">
    <div v-if="error" role="alert" class="rt-alert">{{ error }} <AppButton variant="subtle" size="xs" type="button"  aria-label="Скрыть" @click="error = ''">✕</AppButton></div>
    <template v-if="!detail">
      <div class="rt-entry">
        <div class="rt-title">
          <h2>Ревью МР</h2>
          <span class="muted">Замечания копятся черновиками и уходят в GitLab только после «Опубликовать ревью».</span>
        </div>
        <form class="rt-row" @submit.prevent="open({url})">
          <AppInput v-model="url"  aria-label="Ссылка на МР" placeholder="Вставьте ссылку: https://gitlab.example.com/group/project/-/merge_requests/123" />
          <AppButton variant="blue" size="md" type="submit" :disabled="busy || !url.trim()">Открыть МР</AppButton>
        </form>
        <div class="rt-row rt-list-head">
          <span class="section-label">{{ searched ? 'Найдено' : 'Ждут моего ревью' }}</span>
          <span v-if="!busy && requests.length" class="rt-count">{{ requests.length }}</span>
          <span class="rt-spacer" />
          <form class="rt-search" @submit.prevent="search">
            <AppInput v-model="query"  aria-label="Поиск МР" placeholder="Номер, название или ветка" />
            <AppButton variant="ghost" size="sm" type="submit" :disabled="busy">Найти</AppButton>
          </form>
          <AppButton variant="subtle" size="sm" type="button"  :disabled="busy" title="Загрузить список заново" @click="reset">Обновить</AppButton>
        </div>
        <p v-for="(message,index) in errors" :key="index" role="alert" class="rt-warn">{{ message }}</p>
        <AppEmptyState small v-if="busy && !requests.length" >Загрузка…</AppEmptyState>
        <AppEmptyState small v-else-if="!requests.length" >{{ searched ? 'По запросу «' + searched + '» ничего не найдено.' : 'Нет МР, которые ждут вашего ревью.' }}</AppEmptyState>
        <div class="rt-requests">
          <AppButton
            v-for="request in requests" :key="request.project_id+':'+request.mr.iid" class="request" variant="subtle" block multiline start :disabled="busy"
            @click="open({project_id:request.project_id,iid:request.mr.iid})"
          >
            <span class="rq-top">
              <span class="rq-iid">!{{ request.mr.iid }}</span>
              <span class="rq-title">{{ request.mr.title }}</span>
              <AppBadge dot tone="progress" v-if="request.has_updates" >Есть обновления</AppBadge>
            </span>
            <span class="rq-meta">{{ request.project_name }} · {{ request.mr.author.name }} · <code>{{ request.mr.source_branch }}</code> → <code>{{ request.mr.target_branch }}</code></span>
          </AppButton>
        </div>
      </div>
    </template>
    <template v-else>
      <header class="rt-head">
        <div class="rt-row">
          <AppButton variant="subtle" size="sm" type="button"  :disabled="busy" @click="back">← К списку</AppButton>
          <h3><span class="rq-iid">!{{ snapshot!.mr.iid }}</span> {{ snapshot!.mr.title }}</h3>
          <span class="rt-spacer" />
          <AppButton v-if="safeMrUrl" as="a" variant="subtle" size="sm" :href="safeMrUrl" target="_blank" rel="noopener noreferrer">Открыть в GitLab ↗</AppButton>
          <template v-if="snapshot!.capabilities.approve">
            <AppButton variant="ghost" size="sm" type="button"  :disabled="busy" @click="approve(true)">Approve</AppButton>
            <AppButton variant="subtle" size="sm" type="button"  :disabled="busy" @click="approve(false)">Снять approve</AppButton>
          </template>
          <AppButton variant="ghost" size="sm" type="button"  :disabled="busy" title="Удалить копию кода МР; треды с агентом останутся в истории" @click="finishReview">Завершить ревью</AppButton>
        </div>
        <div class="rt-row rt-meta">
          <span>{{ snapshot!.mr.author.name }} · <code>{{ snapshot!.mr.source_branch }}</code> → <code>{{ snapshot!.mr.target_branch }}</code></span>
          <span class="rt-spacer" />
          <AppBadge dot tone="progress" v-if="detail.changed_files.length"  title="Файлы, изменившиеся с прошлой просмотренной версии">Изменились файлы: {{ detail.changed_files.length }}</AppBadge>
          <label class="rt-version">Версия
            <AppSelect :model-value="String(snapshot!.version.id)" :options="snapshot!.versions.map(v => ({ value: String(v.id), label: formatDateTime(v.created_at) }))" small :disabled="busy" label="Версия" @update:model-value="changeVersion(Number($event))" />
          </label>
          <AppButton variant="subtle" size="sm" v-if="detail.session.previous" type="button"  :disabled="busy" @click="changeVersion(detail.session.previous.version.id)">Предыдущая версия</AppButton>
          <AppButton variant="ghost" size="sm" type="button"  :disabled="busy" title="Подтянуть новую версию МР и обсуждения" @click="changeVersion()">{{ busy ? 'Загрузка…' : 'Обновить' }}</AppButton>
        </div>
      </header>
      <div class="workspace">
        <nav class="files" aria-label="Файлы МР">
          <div class="files-head">Файлы <span class="muted">{{ detail.viewed.length }}/{{ snapshot!.files.length }} просмотрено</span></div>
          <div v-for="file in snapshot!.files" :key="file.new_path" class="file" :class="{ selected: path === file.new_path, viewed: detail.viewed.includes(file.new_path) }">
            <AppCheckbox :model-value="detail.viewed.includes(file.new_path)" :disabled="busy" :aria-label="'Просмотрено: ' + file.new_path" title="Просмотрено" @update:model-value="viewed(file.new_path, $event)" />
            <AppButton class="file-action" variant="subtle" size="sm" multiline start :disabled="busy" :title="file.new_path" @click="chooseFile(file.new_path)">
              <span class="file-name">{{ baseName(file.new_path) }}</span>
              <span class="file-dir">{{ dirName(file.new_path) }}</span>
            </AppButton>
            <AppBadge tone="done" v-if="file.new_file" >A</AppBadge><AppBadge tone="danger" v-else-if="file.deleted_file" >D</AppBadge><AppBadge v-else-if="file.renamed_file" >R</AppBadge>
            <span v-if="detail.changed_files.includes(file.new_path)" class="file-dot" title="Изменён с прошлой версии" />
          </div>
        </nav>
        <main class="diff-area">
          <MrDiff
            v-if="selectedFile" :key="detail.session.id+':'+path" :scope="projectId" :review-id="detail.session.id" :file="selectedFile"
            :head="snapshot!.version.head_commit_sha" :discussions="snapshot!.discussions" :drafts="detail.drafts" :selection="selection" :busy="busy" :reply="reply" @select="selectLine"
          >
            <template #composer>
              <div class="composer" @keydown.esc.stop.prevent="clearSelection" @keydown.enter.ctrl.exact.prevent="saveNote(false)" @keydown.enter.meta.exact.prevent="saveNote(false)">
                <div class="composer-top">
                  <strong>Замечание к строке {{ selection?.startLine }}</strong>
                  <span class="rt-spacer" />
                  <AppButton variant="subtle" size="xs" type="button"  :disabled="busy || privateBusy" title="Приватный тред: видно только вам, в GitLab ничего не уходит" @click="discuss">{{ privateBusy ? 'Готовим копию кода МР…' : '💬 Обсудить с агентом' }}</AppButton>
                </div>
                <AppTextarea block v-model="body"  aria-label="Ваше замечание" placeholder="Напишите замечание" :disabled="busy" rows="3" />
                <div class="composer-actions">
                  <span class="composer-hint">Ctrl+Enter — в черновик · Esc — закрыть</span>
                  <AppButton variant="subtle" size="sm" type="button"  :disabled="busy" @click="clearSelection">Закрыть</AppButton>
                  <AppButton variant="ghost" size="sm" type="button"  :disabled="busy || !body.trim()" title="Отправить в GitLab без черновика" @click="saveNote(true)">Отправить сразу</AppButton>
                  <AppButton variant="blue" size="sm" type="button"  :disabled="busy || !body.trim()" @click="saveNote(false)">В черновик</AppButton>
                </div>
              </div>
            </template>
          </MrDiff>
          <AppEmptyState v-else >В этой версии нет изменённых файлов.</AppEmptyState>
          <details v-if="generalDiscussions.length" class="general">
            <summary>Общие обсуждения ({{ generalDiscussions.length }})</summary>
            <DiscussionThread :review-id="detail.session.id" v-for="d in generalDiscussions" :key="d.id" :discussion="d" :busy="busy" :reply="reply" />
          </details>
        </main>
        <aside v-if="privateSession" class="private-chat">
          <div class="private-head"><strong>Тред с агентом</strong><span class="muted">видно только вам</span><span class="rt-spacer" /><AppButton variant="subtle" size="xs" type="button"  @click="privateSession = ''">Скрыть</AppButton></div>
          <ChatView :key="privateSession" :session-id="privateSession" />
        </aside>
        <DraftPanel :review-id="detail.session.id" :drafts="detail.drafts" :head="snapshot!.version.head_commit_sha" :busy="busy" :publish="publish" :edit="edit" :remove="remove" :recover="recover" />
      </div>
    </template>
  </section>
</template>
<script setup lang="ts">
import AppEmptyState from '@shared/ui/AppEmptyState.vue'
import AppBadge from '@shared/ui/AppBadge.vue'
import AppButton from '@shared/ui/AppButton.vue'
import AppCheckbox from '@shared/ui/AppCheckbox.vue'
import AppInput from '@shared/ui/AppInput.vue'
import AppTextarea from '@shared/ui/AppTextarea.vue'
import { privateThreads, createPrivateThread, finishPrivate } from '../api'
import { useDraft } from '@core/composables/useDraft'
import { computed, ref, watch } from 'vue'
import { ChatView } from '@features/agent-chat'
import { useAppStore } from '@core/stores/app'
import type { LineSelection } from '@shared/code-viewer'
import { errorText } from '@shared/utils/errorText'
import { formatDateTime } from '@shared/utils/datetime'
import { createReviewStore } from '../stores/review'
import AppSelect from '@shared/ui/AppSelect.vue';
import MrDiff from '../components/MrDiff.vue';
import DraftPanel from '../components/DraftPanel.vue';
import DiscussionThread from '../components/DiscussionThread.vue';
const props = defineProps<{
  projectId: string;
}>();
const app = useAppStore();
const { detail, requests, errors, error, busy, list, open, refresh, add, edit, remove, publish, recover, reply, approve, viewed } = createReviewStore(props.projectId);
const privateSession = ref(''), privateBusy = ref(false);
const url = useDraft(() => `mr-review:${detail.value?.session.id ?? "new-" + props.projectId}:composer:url`, () => ''), query = ref(''), searched = ref(''), path = ref(''), selection = useDraft<LineSelection | null>(() => `mr-review:${detail.value?.session.id ?? "new-" + props.projectId}:composer:selection`, () => null), body = useDraft(() => `mr-review:${detail.value?.session.id ?? "new-" + props.projectId}:composer:body`, () => '');
const snapshot = computed(() => detail.value?.session.snapshot);
const selectedFile = computed(() => snapshot.value?.files.find(f => f.new_path === path.value));
const generalDiscussions = computed(() => snapshot.value?.discussions.filter(d => !d.notes[0]?.position) ?? []);
const safeMrUrl = computed(() => {
  try {
    const u = new URL(snapshot.value?.mr.web_url ?? '');
    return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password ? u.href : undefined;
  }
  catch {
    return undefined;
  }
});
const baseName = (value: string) => value.split('/').pop() ?? value;
const dirName = (value: string) => value.includes('/') ? value.slice(0, value.lastIndexOf('/')) : '';
watch(() => snapshot.value, () => {
  if (!selectedFile.value)
    path.value = snapshot.value?.files[0]?.new_path ?? '';
});
async function search() {
  searched.value = query.value.trim();
  await list(searched.value || undefined);
}
async function reset() {
  query.value = '';
  searched.value = '';
  await list();
}
async function leaveComposer() {
  return !body.value.trim() || await app.confirm('Закрыть несохранённое замечание?', { confirmLabel: 'Закрыть' });
}
async function chooseFile(value: string) {
  if (await leaveComposer()) {
    path.value = value;
    selection.value = null;
    body.value = '';
  }
}
async function selectLine(value: LineSelection) {
  if (busy.value)
    return;
  if (await leaveComposer()) {
    selection.value = value;
    body.value = '';
  }
}
async function clearSelection() {
  if (await leaveComposer()) {
    selection.value = null;
    body.value = '';
  }
}
async function changeVersion(version?: number) {
  if (await leaveComposer()) {
    const result = await refresh(version);
    if (result) {
      selection.value = null;
      body.value = '';
    }
  }
}
async function back() {
  if (await leaveComposer()) {
    detail.value = undefined;
    selection.value = null;
    body.value = '';
    await list(searched.value || undefined);
  }
}
async function saveNote(immediate: boolean) {
  if (!selection.value || !body.value.trim() || busy.value)
    return;
  if (immediate && !await app.confirm('Отправить замечание в GitLab? Его сразу увидят участники МР.', { confirmLabel: 'Отправить' }))
    return;
  const s = selection.value;
  if (await add({ body: body.value, path: s.path, side: s.side, line: s.startLine, head: snapshot.value?.version.head_commit_sha }, immediate)) {
    body.value = '';
    selection.value = null;
  }
}

async function discuss() {
  if (!selection.value || !detail.value) return;
  privateBusy.value = true;
  try { const s = selection.value; const t = await createPrivateThread({ params: { projectId: props.projectId, id: detail.value!.session.id }, body: { path: s.path, side: s.side, line: s.startLine, head: snapshot.value!.version.head_commit_sha } }); privateSession.value = t.session_id; }
  catch (cause) { error.value = errorText(cause); } finally { privateBusy.value = false; }
}
async function finishReview() {
  if (!await leaveComposer() || !await app.confirm('Завершить ревью? Копия кода МР будет удалена, треды с агентом останутся в истории.', { confirmLabel: 'Завершить ревью' })) return;
  try { await finishPrivate({ params: { projectId: props.projectId, id: detail.value!.session.id } }); privateSession.value = ''; body.value = ''; await back(); } catch (cause) { error.value = errorText(cause); }
}
watch(() => detail.value?.session.id, async id => {
  privateSession.value = '';
  if (!id) return;
  try { const threads = await privateThreads({ params: { projectId: props.projectId, id: detail.value!.session.id } }); if (detail.value?.session.id === id) privateSession.value = threads.at(-1)?.session_id ?? ''; } catch (cause) { error.value = errorText(cause); }
});
void list();
</script>
<style scoped>
.review-tab { height: 100%; display: flex; flex-direction: column; min-height: 0; font-size: var(--fs-md); }
.rt-alert { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 16px; font-size: var(--fs-sm); color: var(--danger-hover); background: var(--danger-soft); border-bottom: 1px solid var(--border); overflow-wrap: anywhere; }
.rt-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.rt-spacer { flex: 1; }
.section-label { font-size: var(--fs-xs); font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px; }
.rt-count { padding: 0 6px; font-size: var(--fs-xs); font-weight: 600; border-radius: var(--radius-pill); background: var(--bg3); color: var(--text-muted); }

.rt-entry { display: flex; flex-direction: column; gap: 14px; width: 100%; max-width: 920px; margin: 0 auto; padding: 24px 20px; overflow: auto; }
.rt-title { display: flex; flex-direction: column; gap: 2px; }
.rt-title h2 { font-size: var(--fs-lg); }
.rt-entry form.rt-row .control { flex: 1; min-width: 240px; }
.rt-list-head { margin-top: 6px; }
.rt-search { display: flex; gap: 6px; }
.rt-search .control { width: 240px; }
.rt-warn { font-size: var(--fs-sm); padding: 6px 10px; border-radius: var(--radius-sm); color: var(--warning-text); background: var(--warning-soft); }
.rt-requests { display: flex; flex-direction: column; gap: 6px; }
.rq-top { display: flex; align-items: center; gap: 8px; min-width: 0; }
.rq-iid { font-weight: 600; color: var(--text-muted); }
.rq-title { flex: 1; min-width: 0; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rq-meta { font-size: var(--fs-sm); color: var(--text-muted); overflow-wrap: anywhere; }
code { font-size: var(--fs-sm); }

.rt-head { display: flex; flex-direction: column; gap: 6px; flex-shrink: 0; padding: 8px 16px; border-bottom: 1px solid var(--border); }
.rt-head h3 { font-size: var(--fs-base); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rt-head a.btn { text-decoration: none; }
.rt-meta { font-size: var(--fs-sm); color: var(--text-muted); }
.rt-version { display: inline-flex; align-items: center; gap: 6px; }
.workspace { display: flex; flex: 1; min-height: 0; overflow: hidden; }
.files { width: 240px; flex-shrink: 0; overflow: auto; border-right: 1px solid var(--border); }
.files-head { display: flex; align-items: baseline; justify-content: space-between; gap: 6px; padding: 8px 10px; font-size: var(--fs-xs); font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); border-bottom: 1px solid var(--border); }
.files-head .muted { font-size: var(--fs-xs); font-weight: 400; text-transform: none; letter-spacing: 0; }
.file { display: flex; align-items: center; gap: 6px; padding: 3px 8px; }
.file:hover { background: var(--bg-hover); }
.file.selected { background: var(--blue-soft); }
.file-action { flex: 1; }
.file.viewed .file-name { color: var(--text-muted); }
.file-name { font-size: var(--fs-md); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.file-dir { font-size: var(--fs-xs); color: var(--text-faint); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.file-tag { flex-shrink: 0; font-size: var(--fs-xs); font-weight: 700; color: var(--blue-hover); }
.file-tag.add { color: var(--syntax-added); } .file-tag.del { color: var(--danger-hover); }
.file-dot { flex-shrink: 0; width: 7px; height: 7px; border-radius: var(--radius-round); background: var(--warning-text); }
.diff-area { flex: 1; min-width: 0; overflow: auto; display: flex; flex-direction: column; }
.diff-area > div { flex: 1; }
.general { flex-shrink: 0; padding: 8px 12px; border-top: 1px solid var(--border); }
.general summary { cursor: pointer; font-size: var(--fs-sm); color: var(--text-muted); }
.composer { display: flex; flex-direction: column; gap: 6px; margin: 4px 0; padding: 8px; background: var(--bg2); border: 1px solid var(--blue); border-radius: var(--radius); box-shadow: 0 2px 10px var(--overlay-soft); font-size: var(--fs-sm); }
.composer-top { display: flex; align-items: center; gap: 8px; }
.composer-actions { display: flex; align-items: center; gap: 6px; }
.composer-hint { flex: 1; font-size: var(--fs-xs); color: var(--text-faint); }
.private-chat { width: 380px; flex-shrink: 0; display: flex; flex-direction: column; border-left: 1px solid var(--border); }
.private-head { display: flex; align-items: center; gap: 8px; padding: 8px 10px; font-size: var(--fs-sm); border-bottom: 1px solid var(--border); }
.private-chat > :last-child { flex: 1; min-height: 0; }

/* Local secondary text. */
.muted { color: var(--text-muted); font-size: var(--fs-sm); }
</style>
