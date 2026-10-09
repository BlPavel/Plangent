<template>
  <section v-if="git.repository" class="commit" @keydown.enter.ctrl.exact.prevent="commitByKey" @keydown.enter.meta.exact.prevent="commitByKey">
    <div class="cp-head">
      <span class="cp-title">Коммит</span>
      <span class="cp-spacer" />
      <button type="button" class="btn btn-subtle btn-xs" :disabled="generating || !!git.blocked" :title="git.blocked || 'Агент предложит текст по изменениям, отмеченным к коммиту'" @click="generate">✨ {{ generating ? 'Генерация…' : 'Предложить текст' }}</button>
    </div>
    <input v-model="title" class="control control-sm" placeholder="Заголовок коммита" aria-label="Заголовок коммита" :class="{ forbidden, warning: formatWarning }" />
    <label class="cp-check"><input v-model="description" type="checkbox" /> Описание</label>
    <textarea v-if="description" v-model="body" class="control" placeholder="Описание коммита" aria-label="Описание коммита" :class="{ forbidden }" rows="3" />
    <label class="cp-check"><input v-model="includeCoauthors" type="checkbox" /> Соавтор</label>
    <div v-if="includeCoauthors" class="cp-row">
      <input v-model="authorName" class="control control-sm" placeholder="Имя соавтора" aria-label="Имя соавтора" list="git-authors" />
      <input v-model="authorEmail" class="control control-sm" placeholder="email" aria-label="Email соавтора" />
      <datalist id="git-authors"><option v-for="author in git.coauthors" :key="author.email" :value="author.name">{{ author.email }}</option></datalist>
    </div>
    <div v-for="(violation, i) in check?.violations" :key="i" class="cp-violation" :class="violation.kind === 'forbidden' ? 'red' : 'yellow'">Строка {{ violation.line }}: {{ violation.kind === 'forbidden' ? 'Запрещённый текст' : 'Предупреждение формата' }} — {{ violation.text }}</div>
    <div class="cp-actions">
      <button v-if="forbidden" type="button" class="btn btn-ghost btn-sm" title="Убрать запрещённые строки из сообщения" @click="clean">Убрать</button>
      <span class="cp-hint">Ctrl+Enter</span>
      <button v-if="overrideNeeded" type="button" class="btn btn-danger-ghost btn-sm" :disabled="!!git.blocked || checking" @click="commit(true)">Всё равно закоммитить</button>
      <button type="button" class="btn btn-blue btn-sm" :disabled="!canCommit" :title="git.blocked || (title.trim() ? '' : 'Введите заголовок коммита')" @click="commit(false)">{{ committing ? 'Коммит…' : 'Закоммитить' }}</button>
    </div>
    <div v-if="error" role="alert" class="cp-error">{{ error }}</div>
    <pre v-if="shown && git.output" aria-label="Вывод git и хуков">{{ git.output }}</pre>
    <button v-if="committing && git.operationId" type="button" class="btn btn-ghost btn-xs cp-cancel" @click="git.cancel()">Отменить git-операцию</button>
  </section>
</template>
<script setup lang="ts">
import { computed, ref, watch, onBeforeUnmount } from 'vue'
import { gitApi } from '../api'
import { useGitStore } from '../stores/git'
import type { MessageCheck, CommitInput } from '../git-types'
const props = defineProps<{ taskId?: string }>()
const git = useGitStore()
const title = ref(''), body = ref(''), description = ref(false), includeCoauthors = ref(false), authorName = ref(''), authorEmail = ref('')
const generating = ref(false), checking = ref(false), error = ref(''), check = ref<MessageCheck | null>(null), overrideNeeded = ref(false)
/** committing — this panel's commit is running; shown — its hook output is still relevant. */
const committing = ref(false), shown = ref(false)
const input = computed<CommitInput>(() => ({ title: title.value, body: body.value, includeDescription: description.value, includeCoauthors: includeCoauthors.value, coauthors: includeCoauthors.value ? [{ name: authorName.value, email: authorEmail.value }] : [] }))
const forbidden = computed(() => check.value?.violations.some(v => v.kind === 'forbidden'))
const formatWarning = computed(() => check.value?.violations.some(v => v.kind === 'format'))
const canCommit = computed(() => !!title.value.trim() && !git.blocked && !checking.value && !generating.value)
const message = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause)).replace(/^Error:\s*/, '')
let timer: ReturnType<typeof setTimeout> | undefined, version = 0
watch(() => git.settings?.include_description, value => { description.value = value ?? false }, { immediate: true })
watch(authorName, name => { const match = git.coauthors.find(a => a.name === name); if (match) authorEmail.value = match.email })
watch(input, () => { clearTimeout(timer); const current = ++version; check.value = null; overrideNeeded.value = false; error.value = ''; checking.value = true; timer = setTimeout(async () => { try { if (!title.value.trim()) return; const result = await gitApi.checkMessage(git.projectId, input.value); if (current === version) check.value = result } catch (cause) { if (current === version) error.value = message(cause) } finally { if (current === version) checking.value = false } }, 300) })
watch(() => git.lastAction, action => { if (action && action !== 'commit') shown.value = false })
onBeforeUnmount(() => { clearTimeout(timer); version++ })
function clean() { if (!check.value) return; const [first, ...rest] = check.value.cleaned.split('\n'); title.value = first ?? ''; body.value = rest.join('\n').trim(); if (includeCoauthors.value && check.value.cleanedCoauthors && !check.value.cleanedCoauthors.length) includeCoauthors.value = false }
async function generate() { generating.value = true; error.value = ''; try { const text = await gitApi.generateMessage(git.projectId, { taskId: props.taskId, includeDescription: description.value }); title.value = text.title; body.value = text.body } catch (cause) { error.value = message(cause) } finally { generating.value = false } }
function commitByKey() { if (canCommit.value) void commit(false) }
async function commit(overrideForbidden: boolean) {
  error.value = ''; committing.value = true; shown.value = true
  try { await git.run('commit', { ...input.value, overrideForbidden }); title.value = ''; body.value = ''; overrideNeeded.value = false }
  catch (cause) { overrideNeeded.value = (cause as { code?: string }).code === 'forbidden_message'; error.value = overrideNeeded.value ? 'В сообщении есть запрещённый текст. Уберите его или подтвердите коммит как есть.' : message(cause) }
  finally { committing.value = false }
}
</script>
<style scoped>
.commit { padding: 8px 10px 10px; display: flex; flex-direction: column; gap: 6px; border-top: 1px solid var(--border); max-height: 50%; overflow: auto; font-size: 12px; background: var(--bg); }
.cp-head { display: flex; align-items: center; gap: 6px; }
.cp-title { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); }
.cp-spacer { flex: 1; }
.control { width: 100%; }
textarea.control { height: auto; padding: 6px 10px; resize: vertical; line-height: 1.45; }
.control.forbidden { border-color: var(--danger-hover); } .control.warning { border-color: var(--warning); }
.cp-check { display: inline-flex; align-items: center; gap: 6px; color: var(--text-muted); cursor: pointer; align-self: flex-start; }
.cp-check input { margin: 0; accent-color: var(--blue); }
.cp-row { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.cp-violation { line-height: 1.4; overflow-wrap: anywhere; }
.red { color: var(--danger-hover); } .yellow { color: var(--warning-text); }
.cp-actions { display: flex; align-items: center; gap: 6px; justify-content: flex-end; }
.cp-hint { flex: 1; font-size: 11px; color: var(--text-faint); }
.cp-error { padding: 6px 8px; border-radius: var(--radius-sm); color: var(--danger-hover); background: var(--danger-soft); overflow-wrap: anywhere; }
pre { margin: 0; padding: 6px 8px; max-height: 180px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 11.5px; color: var(--text-muted); background: var(--bg2); border-radius: var(--radius-sm); }
.cp-cancel { align-self: flex-start; }
</style>
