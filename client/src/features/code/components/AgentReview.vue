<template>
  <section class="ar" aria-label="Проверка кода агентом">
    <div v-if="setup" class="ar-form">
      <AppSelect v-model="mode" :options="modes" label="Область ревью" block size="sm" :disabled="starting" />
      <BranchSelect v-if="mode === 'branch'" v-model="refName" :options="branchOptions" label="Ветка для сравнения" placeholder="Выберите ветку" small :disabled="starting" />
      <p class="ar-note">{{ mode === 'task' ? 'Всё, что изменилось с начала работы, вместе с закоммиченным.' : mode === 'worktree' ? 'Staged, unstaged и новые файлы относительно HEAD.' : 'От общей базы с выбранной веткой, включая незакоммиченные изменения.' }}</p>
      <ReviewAgentBar label="Агент проверки" :project-id="projectId" :preferred="work?.preferred" :fallback-agent-id="defaultAgentId" read-only :disabled="starting" @change="pick = $event" />
      <AppSelect v-if="!work" v-model="skillId" :options="skillOptions" label="Скилл ревью" block size="sm" :disabled="starting" />
      <AppTextarea v-model="context" aria-label="Что знать агенту" block rows="3" size="sm" spellcheck="false" :disabled="starting" placeholder="Что знать агенту и на что обратить внимание. Например: это первый шаг миграции, особенно посмотри обработку ошибок" />
      <p v-if="preview" class="ar-note">{{ mode === 'branch' ? 'Относительно ' + refLabel : 'Относительно HEAD' }} · {{ preview.files.length }} {{ fileWord(preview.files.length) }} · база {{ preview.base.slice(0, 8) }}</p>
      <p v-else-if="previewing" class="ar-note">Собираю область проверки…</p>
      <div class="ar-row">
        <AppButton size="xs" variant="ghost" :disabled="starting" @click="setup = false">Отмена</AppButton>
        <AppButton size="xs" variant="blue" :disabled="starting || !pick || code.agentWorking || (mode !== 'task' && (previewing || !preview?.files.length))" @click="start">{{ starting ? 'Запуск…' : 'Начать проверку' }}</AppButton>
      </div>
    </div>
    <!-- After the start the settings are gone: who reviews, what they do now, their full log on demand (as in the merge request review). -->
    <template v-else>
      <div v-if="selected" class="ar-agent">
        <span class="ar-dot" :class="selected.status" />
        <span class="ar-name" :title="rangeLabel">{{ agentName }}</span>
        <span class="ar-status" role="status">{{ selected.status === 'starting' ? 'Подключается' : running ? 'Агент проверяет код…' : statusLabel(selected.status) }}</span>
        <span class="ar-spacer" />
        <AppButton v-if="running" size="xs" variant="ghost" :disabled="stopping" @click="stop">Остановить</AppButton>
        <AppButton size="xs" variant="ghost" :title="journal === selected.id ? 'Вернуться к замечаниям' : 'Полный лог агента: рассуждения, команды, настройки модели'" @click="emit('update:journal', journal === selected.id ? '' : selected.id)">{{ journal === selected.id ? '← Замечания' : 'Журнал' }}</AppButton>
      </div>
      <div v-if="selected" class="ar-usage">
        <span>Контекст и лимиты</span>
        <UsageMeter :agent-id="selected.agent_id" :usage="(selected.metadata.usage as UsageInfo | undefined) ?? null" placement="below" show-unavailable />
      </div>
      <div v-if="reports.length > 1 || (!running && canStart)" class="ar-row">
        <AppSelect v-if="reports.length > 1" :model-value="selected?.id ?? ''" @update:model-value="selectedId = $event" :options="reports.map((s, i) => ({ value: s.id, label: 'Проверка ' + (reports.length - i) + ' из ' + reports.length, description: statusLabel(s.status) }))" label="История проверок" title="Чей отчёт показан: история проверок" variant="subtle" size="sm" />
        <span class="ar-spacer" />
        <AppButton v-if="!running && canStart" size="sm" :disabled="starting || code.agentWorking" @click="setup = true">🤖 {{ selected ? 'Ревью ещё раз' : 'Ревью агентом' }}</AppButton>
      </div>
    </template>
    <p v-if="error" role="alert" class="ar-error">{{ error }}</p>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { CodeReviewLaunch, CodeReviewPreview } from '@contracts'
import { ReviewAgentBar, UsageMeter, statusLabel, useChatStore, type ReviewAgentPick, type UsageInfo } from '@features/agent-chat'
import { useAgentsStore } from '@features/agents'
import { branchReviewEndpoints } from '@features/branch-review'
import AppButton from '@shared/ui/AppButton.vue'
import AppSelect from '@shared/ui/AppSelect.vue'
import AppTextarea from '@shared/ui/AppTextarea.vue'
import BranchSelect from '@shared/ui/BranchSelect.vue'
import { codeEndpoints } from '../api'
import { useCodeContext, useGitContext } from '../stores/context'
import type { WorkAgentReview } from '../types'

const props = defineProps<{ projectId: string; defaultAgentId?: string | null; /** A work's Проверка: the work launches the review. */ work?: WorkAgentReview | null; /** Session whose log replaces the remarks list ('' — none). */ journal: string }>()
const emit = defineEmits<{ 'update:journal': [sessionId: string] }>()
const code = useCodeContext(), git = useGitContext(), chats = useChatStore(), agents = useAgentsStore()
const setup = ref(false), starting = ref(false), stopping = ref(false), error = ref('')
const canStart = computed(() => !!code.repository && !code.readOnly && !code.openedReviewId)
const agentName = computed(() => agents.agents.find(a => a.id === selected.value?.agent_id)?.name || 'Агент')
const mode = ref<'task' | 'worktree' | 'branch'>(props.work ? 'task' : 'worktree'), refName = ref(''), skillId = ref(''), context = ref('')
const pick = ref<ReviewAgentPick | null>(null), preview = ref<CodeReviewPreview | null>(null), previewing = ref(false)
const skills = ref<{ id: string; title: string }[]>([]), selectedId = ref('')
const modes = [...(props.work ? [{ value: 'task', label: 'Всё по работе' }] : []), { value: 'worktree', label: 'Текущие изменения' }, { value: 'branch', label: 'Относительно ветки…' }]
const branchOptions = computed(() => git.branches.map(b => ({ value: b.ref, label: b.name })))
const refLabel = computed(() => branchOptions.value.find(b => b.value === refName.value)?.label ?? refName.value)
const fileWord = (n: number) => n % 10 === 1 && n % 100 !== 11 ? 'файл' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'файла' : 'файлов'
const skillOptions = computed(() => [{ value: '', label: 'Общая инструкция' }, ...skills.value.map(s => ({ value: s.id, label: s.title }))])
const reports = computed(() => [...code.rounds].reverse().flatMap(round => {
  const session = chats.sessions.find(s => s.id === round.session_id && s.role === 'task-reviewer')
  return session ? [session] : []
}))
const selected = computed(() => reports.value.find(s => s.id === selectedId.value) ?? reports.value[0])
const running = computed(() => reports.value.some(s => ['starting', 'thinking', 'waiting'].includes(s.status)))
const rangeLabel = computed(() => {
  const range = selected.value?.metadata.code_review_range as { mode?: string; ref?: string } | undefined
  return range ? (range.mode === 'task' ? 'Всё по работе' : range.mode === 'branch' ? 'Относительно ' + range.ref?.replace(/^refs\/(heads|remotes)\//, '') : 'Текущие изменения') : 'Проверка задачи'
})
function range(): CodeReviewLaunch { return { mode: mode.value === 'task' ? 'worktree' : mode.value, ...(mode.value === 'branch' ? { ref: refName.value } : {}) } }
watch(() => props.projectId, async (id, _old, cleanup) => {
  let stale = false
  cleanup(() => { stale = true })
  setup.value = false; preview.value = null; selectedId.value = ''; error.value = ''; emit('update:journal', '')
  refName.value = ''; mode.value = props.work ? 'task' : 'worktree'; skillId.value = ''; skills.value = []; context.value = ''
  try {
    const value = await branchReviewEndpoints.getProjectsByProjectIdBranchReviewSkills({ params: { projectId: id } })
    if (!stale) skills.value = value
  } catch (cause) { if (!stale) error.value = String(cause) }
}, { immediate: true })
watch([setup, mode, refName, () => code.workspaceId, () => code.repository, () => code.changes], async (_value, _old, cleanup) => {
  let stale = false
  cleanup(() => { stale = true })
  preview.value = null; previewing.value = false
  if (!setup.value || mode.value === 'task') return
  if (mode.value === 'branch' && !refName.value) { refName.value = git.branches.find(b => b.name === git.baseRef)?.ref ?? ''; if (!refName.value) return }
  previewing.value = true; error.value = ''
  try {
    const value = await codeEndpoints.previewAgentReview({ params: { projectId: props.projectId }, body: range(), query: { workspace: code.workspaceId } })
    if (!stale) preview.value = value
  } catch (cause) { if (!stale) error.value = String(cause) }
  finally { if (!stale) previewing.value = false }
})
async function start() {
  if (!pick.value || starting.value) return
  starting.value = true; error.value = ''
  const projectId = props.projectId, workspace = code.workspaceId
  if (props.work) {
    const ok = await props.work.run({ mode: mode.value, ...(mode.value === 'branch' ? { ref: refName.value } : {}),
      agent_id: pick.value.agent_id, model: pick.value.model, effort: pick.value.effort, config: pick.value.config, ...(context.value.trim() ? { context: context.value.trim() } : {}) })
    starting.value = false
    if (ok) { setup.value = false; selectedId.value = ''; context.value = ''; await code.refresh() }
    return
  }
  try {
    const session = await codeEndpoints.startAgentReview({ params: { projectId }, query: { workspace }, body: {
      ...range(), agent_id: pick.value.agent_id, model: pick.value.model, effort: pick.value.effort,
      config: pick.value.config, skill_id: skillId.value, context: context.value,
    } })
    chats.put(session)
    if (projectId !== props.projectId || workspace !== code.workspaceId) return
    selectedId.value = session.id; setup.value = false; context.value = ''
    await code.refresh()
  } catch (cause) { if (projectId === props.projectId && workspace === code.workspaceId) error.value = String(cause) }
  finally { starting.value = false }
}
async function stop() {
  if (!code.review || stopping.value) return
  stopping.value = true
  try { await code.stopAgent(code.review.id) }
  catch (cause) { error.value = String(cause) }
  finally { stopping.value = false }
}
</script>

<style scoped>
.ar { display: flex; flex-direction: column; gap: var(--sp-2); padding: var(--sp-2) var(--sp-3); border-bottom: 1px solid var(--border); font-size: var(--fs-sm); flex-shrink: 0; }
.ar-row { display: flex; align-items: center; flex-wrap: wrap; gap: var(--sp-2); }
.ar-form { display: flex; flex-direction: column; gap: var(--sp-2); }
.ar-note { color: var(--text-muted); font-size: var(--fs-xs); overflow-wrap: anywhere; }
.ar-error { color: var(--danger-hover); overflow-wrap: anywhere; }
.ar-agent { display: flex; align-items: center; gap: 6px; min-height: 28px; }
.ar-usage { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; color: var(--text-muted); font-size: var(--fs-xs); }
.ar-name { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ar-status { color: var(--text-muted); white-space: nowrap; }
.ar-spacer { flex: 1; }
.ar-dot { width: 7px; height: 7px; flex-shrink: 0; border-radius: var(--radius-round); background: var(--border-strong); }
.ar-dot.thinking, .ar-dot.starting { background: var(--blue-hover); animation: ar-pulse 1.4s ease-in-out infinite; }
.ar-dot.waiting { background: var(--warning-text); }
.ar-dot.complete, .ar-dot.ready { background: var(--accent-hover); }
.ar-dot.error { background: var(--danger-hover); }
@keyframes ar-pulse { 50% { opacity: 0.35; } }
</style>
