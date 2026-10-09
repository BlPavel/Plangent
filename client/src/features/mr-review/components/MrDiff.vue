<template>
  <div class="mr-diff">
    <p v-if="error" role="alert" class="state error">Не удалось загрузить файл: {{ error }}</p>
    <p v-else-if="!hunks.length" class="state">{{ file.too_large || file.collapsed ? 'Diff слишком большой — откройте файл в GitLab.' : 'В этой версии нет текстового diff. Файл может быть бинарным или изменились только его свойства.' }}</p>
    <p v-else-if="!contentReady" class="state">Загрузка файла…</p>
    <CodeView
      v-else v-model:mode="mode" :file="viewer" :hunks="hunks" :original-path="file.old_path"
      :markers="markers('new')" :old-markers="markers('old')" :widget-lines="lines('new')" :old-widget-lines="lines('old')"
      @select="$emit('select',$event)" @marker-click="(line,side)=>$emit('select',{path:file.new_path,side,startLine:line,endLine:line})"
    >
      <template #widget="{line,side}">
        <DiscussionThread v-for="discussion in at(line,side)" :key="discussion.id" :discussion="discussion" :busy="busy" :reply="reply" />
        <div v-for="draft in draftsAt(line,side)" :key="draft.id" class="draft" :class="draft.status"><span class="draft-tag">{{ draft.status === 'sent' ? 'Отправлено' : 'Мой черновик' }}</span>{{ draft.body }}</div>
        <slot v-if="selection?.side===side && selection.startLine===line" name="composer" />
      </template>
    </CodeView>
    <div v-if="unplaced.length" class="other-discussions">
      <h4>Обсуждения вне текущего diff</h4>
      <DiscussionThread v-for="d in unplaced" :key="d.id" :discussion="d" :busy="busy" :reply="reply" :outdated="!!d.notes[0]?.position && d.notes[0].position.head_sha!==head" />
    </div>
  </div>
</template>
<script setup lang="ts">
import { computed, ref, watch, onBeforeUnmount } from 'vue';
import { CodeView, parseUnifiedDiff, type LineSelection, type CodeSide } from '@shared/code-viewer';
import { mrReviewApi } from '../api';
import type { MrDiff, HostDiscussion, DiffPosition } from '../host-types';
import type { MrDraft } from '../types';
import DiscussionThread from './DiscussionThread.vue';
const props = defineProps<{
  scope: string;
  reviewId: string;
  head: string;
  file: MrDiff;
  discussions: HostDiscussion[];
  drafts: MrDraft[];
  selection: LineSelection | null;
  busy: boolean;
  reply: (discussion: string, body: string) => Promise<unknown>;
}>();
defineEmits<{
  select: [
    selection: LineSelection
  ];
}>();
const mode = ref<'file' | 'diff'>('diff'), content = ref(''), error = ref(''), contentReady = ref(false);
const hunks = computed(() => parseUnifiedDiff(props.file.diff));
const viewer = computed(() => ({ path: props.file.new_path, kind: 'text' as const, size: content.value.length, content: content.value }));
let controller: AbortController | undefined;
watch(() => [props.scope, props.reviewId, props.head, props.file.new_path, props.file.diff], async () => {
  controller?.abort();
  const mine = controller = new AbortController();
  contentReady.value = false;
  error.value = '';
  if (!hunks.value.length) {
    content.value = '';
    contentReady.value = true;
    return;
  }
  try {
    const result = await mrReviewApi.file(props.scope, props.reviewId, props.file.new_path, props.head, mine.signal);
    if (!mine.signal.aborted) {
      content.value = result.content;
      contentReady.value = true;
    }
  }
  catch (e) {
    if (!mine.signal.aborted)
      error.value = e instanceof Error ? e.message : String(e);
  }
}, { immediate: true });
onBeforeUnmount(() => controller?.abort());
const matches = (p?: DiffPosition | null) => !!p && p.head_sha === props.head && p.new_path === props.file.new_path;
const coordinate = (p: DiffPosition, side: CodeSide) => side === 'old' ? p.new_line == null ? p.old_line ?? undefined : undefined : p.new_line ?? undefined;
const at = (line: number, side: CodeSide) => props.discussions.filter(d => {
  const p = d.notes[0]?.position;
  return matches(p) && coordinate(p!, side) === line;
});
const draftsAt = (line: number, side: CodeSide) => props.drafts.filter(d => matches(d.position) && coordinate(d.position!, side) === line);
function lines(side: CodeSide) {
  const values = props.discussions.map(d => d.notes[0]?.position).concat(props.drafts.map(d => d.position ?? undefined)).filter(matches).map(p => coordinate(p!, side)).filter((n): n is number => n !== undefined);
  if (props.selection?.side === side)
    values.push(props.selection.startLine);
  return [...new Set(values)];
}
const markers = (side: CodeSide) => lines(side).map(line => ({ line, count: at(line, side).length + draftsAt(line, side).length, title: 'Обсуждения и замечания' }));
const unplaced = computed(() => props.discussions.filter(d => {
  const p = d.notes[0]?.position;
  return p && p.new_path === props.file.new_path && !matches(p);
}));
</script>
<style scoped>
.mr-diff{height:100%;display:flex;flex-direction:column;min-height:360px}
.mr-diff :deep(.code-view){flex:1;min-height:320px}
.state{padding:24px;text-align:center;font-size:12.5px;color:var(--text-muted)}
.state.error{color:var(--danger-hover)}
.other-discussions{flex-shrink:0;max-height:300px;overflow:auto;padding:8px 12px;border-top:1px solid var(--border)}
.other-discussions h4{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--text-muted)}
.draft{margin:4px 0;padding:6px 8px;font-size:12px;white-space:pre-wrap;overflow-wrap:anywhere;border:1px solid var(--border-strong);border-left:3px solid var(--blue);border-radius:var(--radius-sm);background:var(--bg2)}
.draft.sent{border-left-color:var(--accent)}
.draft-tag{display:block;margin-bottom:2px;font-size:10.5px;font-weight:600;color:var(--blue-hover)}
.draft.sent .draft-tag{color:var(--accent-hover)}
</style>
