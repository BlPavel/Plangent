<template>
  <div class="et" :class="{ resolved: thread.resolved }">
    <div class="et-head">
      <span class="et-badge" title="Комментарий из GitLab, не тред с агентом">GitLab</span>
      <span v-if="thread.resolved" class="et-muted">решено</span>
      <button v-if="showLocation && thread.path" type="button" class="et-link" @click="emit('goto')">{{ thread.path }}<template v-if="thread.line">:{{ thread.line }}</template></button>
      <span class="et-spacer" />
      <button v-if="canDiscuss" type="button" class="et-link" title="Создать пункт ревью с этим комментарием и разобрать его с агентом" @click="emit('discuss', thread)">Разобрать с агентом</button>
      <button v-if="!replying" type="button" class="et-link" @click="replying = true">Ответить</button>
    </div>
    <div v-for="note in thread.notes" :key="note.id" class="et-note">
      <span class="et-author">{{ note.author }}</span>
      <div class="et-body">{{ note.body }}</div>
    </div>
    <form v-if="replying" class="et-reply" @submit.prevent="send" @keydown.esc.stop.prevent="replying = false">
      <textarea v-model="text" rows="3" placeholder="Ответ уйдёт в обсуждение GitLab" spellcheck="false" />
      <div class="et-actions">
        <span class="et-muted">Ответ увидят все участники МР</span>
        <AppButton type="button" size="xs" variant="ghost" @click="replying = false">Отмена</AppButton>
        <AppButton type="submit" size="xs" variant="blue" :disabled="!text.trim() || busy">{{ busy ? 'Отправка…' : 'Отправить в GitLab' }}</AppButton>
      </div>
      <div v-if="error" class="et-error">{{ error }}</div>
    </form>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import AppButton from '@shared/ui/AppButton.vue'
import { useAppStore } from '@core/stores/app'
import { useExternalThreadsStore } from '../stores/external'
import type { ExternalThread } from '../types'

const props = defineProps<{ thread: ExternalThread; showLocation?: boolean; canDiscuss?: boolean }>()
const emit = defineEmits<{ goto: []; discuss: [thread: ExternalThread] }>()
const store = useExternalThreadsStore()
const app = useAppStore()
const replying = ref(false), text = ref(''), busy = ref(false), error = ref('')

async function send() {
  if (!(await app.confirm('Отправить ответ в обсуждение GitLab? Его увидят все участники МР.', { confirmLabel: 'Отправить' }))) return
  busy.value = true; error.value = ''
  try {
    await store.reply(props.thread.id, text.value.trim())
    text.value = ''; replying.value = false
  } catch (cause) { error.value = cause instanceof Error ? cause.message : 'Не удалось отправить ответ' }
  finally { busy.value = false }
}
</script>

<style scoped>
.et { margin: 6px 0; padding: 6px 8px; font-size: 12px; border: 1px solid var(--border-strong); border-left: 3px solid var(--warning-text); border-radius: var(--radius-sm); background: var(--bg2); }
.et.resolved { opacity: 0.7; border-left-color: var(--border-strong); }
.et-head { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.et-badge { padding: 0 6px; font-size: 10px; font-weight: 600; border-radius: var(--radius-pill); background: var(--bg3); color: var(--text-muted); }
.et-spacer { flex: 1; }
.et-muted { font-size: 11px; color: var(--text-muted); }
.et-link { padding: 0; font: inherit; font-size: 11.5px; color: var(--blue-hover); background: none; border: none; cursor: pointer; overflow-wrap: anywhere; text-align: left; }
.et-note { margin-top: 6px; }
.et-author { font-weight: 600; }
.et-body { white-space: pre-wrap; overflow-wrap: anywhere; }
.et-reply { margin-top: 6px; }
.et-reply textarea { width: 100%; box-sizing: border-box; font: inherit; resize: vertical; }
.et-actions { display: flex; align-items: center; gap: 6px; margin-top: 4px; }
.et-actions .et-muted { flex: 1; }
.et-error { margin-top: 4px; color: var(--danger-hover); }
</style>
