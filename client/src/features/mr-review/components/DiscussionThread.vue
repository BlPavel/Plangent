<template>
  <article class="discussion" :class="{ resolved: discussion.notes[0]?.resolved || outdated }">
    <div class="d-head">
      <span class="d-badge" title="Обсуждение в GitLab">GitLab</span>
      <span v-if="outdated" class="d-muted">к другой версии</span>
      <span v-if="discussion.notes[0]?.resolved" class="d-muted">решено</span>
      <span class="d-spacer" />
      <button v-if="!replying" type="button" class="d-link" :disabled="busy" @click="replying = true">Ответить</button>
    </div>
    <div v-for="note in discussion.notes" :key="note.id" class="d-note">
      <span class="d-author">{{ note.author.name }}</span>
      <MessageMarkdown :text="note.body" />
    </div>
    <form v-if="replying" class="d-reply" @submit.prevent="send" @keydown.esc.stop.prevent="replying = false" @keydown.enter.ctrl.exact.prevent="send" @keydown.enter.meta.exact.prevent="send">
      <textarea v-model="body" class="control" aria-label="Ответ в обсуждение" placeholder="Ответ уйдёт в обсуждение GitLab" :disabled="busy" rows="2" />
      <div class="d-actions">
        <span class="d-muted">Ответ увидят все участники МР · Ctrl+Enter</span>
        <button type="button" class="btn btn-subtle btn-xs" @click="replying = false">Отмена</button>
        <button type="submit" class="btn btn-blue btn-xs" :disabled="busy || !body.trim()">Отправить в GitLab</button>
      </div>
    </form>
  </article>
</template>
<script setup lang="ts">
import { ref } from 'vue';
import MessageMarkdown from '@shared/ui/MessageMarkdown.vue';
import { useAppStore } from '@core/stores/app';
import type { HostDiscussion } from '../host-types';
const props = defineProps<{
  discussion: HostDiscussion;
  busy: boolean;
  outdated?: boolean;
  reply: (discussion: string, body: string) => Promise<unknown>;
}>();
const app = useAppStore();
const body = ref(''), replying = ref(false);
async function send() {
  if (props.busy || !body.value.trim())
    return;
  if (!await app.confirm('Отправить ответ в обсуждение GitLab? Его увидят все участники МР.', { confirmLabel: 'Отправить' }))
    return;
  const result = await props.reply(props.discussion.id, body.value);
  if (result) {
    body.value = '';
    replying.value = false;
  }
}
</script>
<style scoped>
.discussion { margin: 6px 0; padding: 6px 8px; font-size: 12px; border: 1px solid var(--border-strong); border-left: 3px solid var(--warning-text); border-radius: var(--radius-sm); background: var(--bg2); overflow-wrap: anywhere; }
.discussion.resolved { opacity: 0.7; border-left-color: var(--border-strong); }
.d-head { display: flex; align-items: center; gap: 6px; }
.d-badge { padding: 0 6px; font-size: 10px; font-weight: 600; border-radius: var(--radius-pill); background: var(--bg3); color: var(--text-muted); }
.d-muted { font-size: 11px; color: var(--text-muted); }
.d-spacer { flex: 1; }
.d-link { padding: 0; font: inherit; font-size: 11.5px; color: var(--blue-hover); background: none; border: none; cursor: pointer; }
.d-link:disabled { opacity: .5; cursor: default; }
.d-note { margin-top: 6px; }
.d-author { font-weight: 600; }
.d-reply { display: flex; flex-direction: column; gap: 4px; margin-top: 6px; }
.d-reply textarea { width: 100%; height: auto; padding: 6px 8px; resize: vertical; font-size: 12px; line-height: 1.45; }
.d-actions { display: flex; align-items: center; gap: 6px; }
.d-actions .d-muted { flex: 1; }
</style>
