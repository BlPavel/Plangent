<template>
  <div class="plan-tab" :class="{ 'with-review': plan && reviewShown }">
    <div ref="planMain" class="plan-main">
      <!-- Planning with an agent: plan on the left, chat on the right, header always visible -->
      <template v-if="!readonly && planningOpen">
        <header class="planning-bar">
          <div class="planning-status" :class="{ live: planningLive }">
            <span class="planning-dot" />
            {{ planningLive ? 'Идёт планирование с агентом' : 'Планирование с агентом' }}
          </div>
          <span v-if="plan?.steps.length" class="planning-meta">{{ plan.steps.length }} {{ stepsWord(plan.steps.length) }}</span>
          <div class="planning-actions">
            <AppButton variant="ghost" size="sm" title="Вернуться к плану. Чаты сохранятся" @click="$emit('closePlanning')">Закрыть</AppButton>
            <AppButton
              variant="primary"
              size="sm"
              :disabled="!plan?.steps.length"
              :title="plan?.steps.length ? 'Остановить агентов и зафиксировать план. Чаты сохранятся' : 'Плана пока нет'"
              @click="$emit('approvePlan')"
            >✓ Утвердить план</AppButton>
          </div>
        </header>

        <SplitPane storage-key="plangent.planningShare">
          <template #start>
            <section class="plan-pane">
              <nav v-if="plan?.steps.length" class="review-step-nav" aria-label="Шаги плана">
                <AppButton v-for="s in plan.steps" :key="s.id ?? s.index" variant="subtle" size="xs" :data-step-id="s.id" :title="s.id && remarkCounts[s.id] ? `Открытых замечаний ревью плана: ${remarkCounts[s.id]}` : ''" :pressed="!!s.id && highlighted.includes(s.id)" @click="s.id && focusStepCard(s.id)">{{ s.id }}<span v-if="s.id && remarkCounts[s.id]"> ⚠{{ remarkCounts[s.id] }}</span></AppButton>
              </nav>
              <MessageMarkdown v-if="planText" class="plan-doc" :text="planText" />
              <div v-else class="plan-waiting">
                {{ planningLive ? 'Ожидаем план от агента…' : 'План появится здесь, когда агент его составит' }}
              </div>
            </section>
          </template>
          <template #end>
            <TaskChats
              class="chat-pane"
              label="План"
              :chats="planningChats"
              :selected="selectedPlanningChat"
              :initials="initials"
              @select="$emit('selectPlanningChat', $event)"
              @remove="(id, name) => $emit('removePlanningChat', id, name)"
            >
              <template #new>
                <NewChatPanel :draft-key="`task:${taskId}:plan-chat`"
                  :project-id="projectId"
                  :default-agent-id="defaultAgentId"
                  title="Планирование"
                  :text="plan ? 'Скажите, что изменить в плане. Агент изучит код и обновит план — в проекте он ничего не меняет.' : 'Опишите задачу — агент изучит код и составит план. В проекте он ничего не меняет, план появится слева.'"
                  :placeholder="plan ? 'Что изменить в плане…' : 'Опишите задачу…  @ — файл'"
                  fixed-policy="read-only"
                  :initial-text="plan ? '' : 'Составь план по анализу задачи'"
                  :busy="planningLaunching"
                  :error="planningError"
                  @start="$emit('launchPlanning', $event)"
                />
              </template>
            </TaskChats>
          </template>
        </SplitPane>
      </template>

      <!-- Empty state — no plan yet -->
      <div v-else-if="!plan && (!editingPlan || readonly)" class="plan-tab-content">
        <div class="plan-panel-header">
          <div class="progress-line"><span>Плана пока нет</span></div>
          <div v-if="!readonly" class="plan-header-actions">
            <AppButton variant="primary" size="sm" @click="$emit('openPlanning')">▸ Составить план с агентом</AppButton>
            <AppButton variant="ghost" size="sm" @click="$emit('startManualEdit')">Написать вручную</AppButton>
          </div>
        </div>
      </div>

      <!-- Plan editor (manual) -->
      <div v-else-if="editingPlan && !readonly" class="plan-tab-content">
        <div class="plan-editor-wrap">
          <StaleDraftNote v-if="staleDraft" @reload="$emit('reloadDraft')" />
          <AppTextarea
            :model-value="planContent"
            @update:model-value="$emit('update:planContent', $event)"
            mono block rows="18"
            placeholder="---&#10;plangent: 1&#10;key: KEY&#10;title: Title&#10;status: open&#10;---&#10;&#10;- [ ] (p1) Step 1&#10;- [ ] (p2) Step 2"
          />
          <div class="plan-editor-helper">
            <span><code>[ ]</code> в начале строки = шаг очереди. Удалишь скобки - шаг пропадёт.</span>
            <div v-if="checkboxLinePreviews.length" class="checkbox-preview">
              <span v-for="line in checkboxLinePreviews" :key="line.text" class="checkbox-line"><code>{{ line.marker }}</code>{{ line.text }}</span>
            </div>
          </div>
          <div class="plan-actions">
            <AppButton variant="primary" size="sm" @click="$emit('savePlan')">Сохранить</AppButton>
            <AppButton variant="ghost" size="sm" @click="$emit('cancelEdit')">Отмена</AppButton>
          </div>
        </div>
      </div>

      <!-- Plan view -->
      <div v-else class="plan-tab-content">
        <div class="plan-panel-header">
          <div class="progress-line">
            <span>{{ doneCount }}/{{ plan!.steps.length }} шагов</span>
            <div class="progress-bar">
              <div class="progress-fill" :style="{ width: progressPct + '%' }" />
            </div>
          </div>
          <div v-if="!readonly" class="plan-header-actions">
            <AppButton variant="blue" size="sm" @click="$emit('openPlanning')">▸ Изменить план с агентом</AppButton>
            <AppButton variant="ghost" size="sm" :pressed="reviewOpen" title="Показать или скрыть ревью утверждённого плана справа: агент проверит план, замечания разбираете вы" @click="reviewOpen = !reviewOpen">Ревью плана{{ attention ? ` (${attention})` : '' }}</AppButton>
            <AppButton variant="subtle" size="sm" @click="$emit('togglePlanEdit')">Редактировать вручную</AppButton>
          </div>
        </div>
        <div class="steps">
          <div v-for="s in plan!.steps" :key="s.id ?? s.index" class="step" :data-step-id="s.id" :class="{ done: s.done, highlighted: !!s.id && highlighted.includes(s.id) }">
            <span class="step-check readonly" :class="{ done: s.done }">{{ s.done ? '✓' : '' }}</span>
            <span class="step-id" v-if="s.id">{{ s.id }}</span>
            <span class="step-text"><AnalysisLinks :text="s.text" /></span>
            <AppButton v-if="s.id && remarkCounts[s.id]" variant="subtle" size="xs" :aria-label="`Замечания к ${s.id}: ${remarkCounts[s.id]}`" :title="`Открытых замечаний ревью плана: ${remarkCounts[s.id]}`" @click="focusStepCard(s.id)">⚠{{ remarkCounts[s.id] }}</AppButton>
            <AppBadge v-if="s.parallelGroup" >параллельно: {{ s.parallelGroup }}</AppBadge>
          </div>
        </div>
      </div>
    </div>
    <PlanReviewPanel v-if="plan" v-show="reviewShown" ref="reviewPanel" :project-id="projectId" :task-id="taskId" :default-agent-id="defaultAgentId" :locked="queueFrozen" :readonly="!!readonly" @highlight="highlightSteps" @counts="remarkCounts = $event" @attention="attention = $event; $emit('reviewAttention', $event)" @close="reviewOpen = false" @open-planner="openPlannerChat" />
  </div>
</template>
<script setup lang="ts">
import AppBadge from '@shared/ui/AppBadge.vue'
import StaleDraftNote from '@shared/ui/StaleDraftNote.vue'
import { computed, nextTick, ref } from 'vue'
import PlanReviewPanel from './plan-review/PlanReviewPanel.vue'
import AnalysisLinks from './AnalysisLinks.vue'
import TaskChats from './TaskChats.vue'
import { NewChatPanel, MessageMarkdown, type NewChatRequest, type ContentBlock } from '@features/agent-chat'
import AppButton from '@shared/ui/AppButton.vue'
import AppTextarea from '@shared/ui/AppTextarea.vue'
import SplitPane from '@shared/ui/SplitPane.vue'
import type { Plan } from '@contracts'

const props = defineProps<{
  readonly?: boolean
  plan: Plan | null
  projectId: string
  taskId: string
  queueFrozen: boolean
  defaultAgentId?: string | null
  staleDraft?: boolean
  planningOpen: boolean
  /** A planning chat is starting or thinking right now. */
  planningLive: boolean
  planningChats: { id: string; title: string }[]
  selectedPlanningChat: string | null
  initials: Record<string, ContentBlock[]>
  planningLaunching: boolean
  planningError: string
  editingPlan: boolean
  planContent: string
  checkboxLinePreviews: { marker: string; text: string }[]
  doneCount: number
  progressPct: number
}>()
const emit = defineEmits<{
  reloadDraft: []
  approvePlan: []
  reviewAttention: [count: number]
  openPlanning: []
  closePlanning: []
  selectPlanningChat: [id: string | null]
  removePlanningChat: [id: string, name: string]
  launchPlanning: [request: NewChatRequest]
  startManualEdit: []
  togglePlanEdit: []
  savePlan: []
  cancelEdit: []
  'update:planContent': [v: string]
}>()

const remarkCounts = ref<Record<string, number>>({})
// The review panel is opened on demand; the number on its button is the cards that wait for the developer.
const reviewOpen = ref(false), attention = ref(0)
// Review applies to the approved plan only: while the plan is being worked on with an agent, the panel stays hidden.
const reviewShown = computed(() => reviewOpen.value && !(props.planningOpen && !props.readonly))
function focusStepCard(id: string) { if (props.planningOpen) return; reviewOpen.value = true; void nextTick(() => reviewPanel.value?.focusStep(id)) }
// A card sent to a planner links to that planner's chat, in the planning view.
function openPlannerChat(id: string) { emit('openPlanning'); emit('selectPlanningChat', id) }
const highlighted = ref<string[]>([])
const planMain = ref<HTMLElement>()
const reviewPanel = ref<InstanceType<typeof PlanReviewPanel>>()
function highlightSteps(ids: string[]) {
  highlighted.value = ids
  void nextTick(() => planMain.value?.querySelector<HTMLElement>('[data-step-id="' + ids[0] + '"]')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }))
}
// The plan file as a readable document: no frontmatter or Plangent's hint comment, steps as check marks.
const planText = computed(() => (props.plan?.content ?? '')
  .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '')
  .replace(/<!--[\s\S]*?-->\r?\n?/g, '')
  .replace(/^(\s*)-\s*\[([ x])\]\s+(?:\((p\d+)\)\s+)?/gim, (_m, indent: string, mark: string, id?: string) =>
    `${indent}- ${mark === ' ' ? '☐' : '☑'} ${id ? `\`${id}\` ` : ''}`)
  .trim())

function stepsWord(n: number) {
  const tens = n % 100, ones = n % 10
  return tens >= 11 && tens <= 14 ? 'шагов' : ones === 1 ? 'шаг' : ones >= 2 && ones <= 4 ? 'шага' : 'шагов'
}
</script>
<style scoped>
.review-step-nav { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 10px; }
.plan-main { flex: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column; overflow: hidden; }
.plan-tab.with-review { flex-direction: row; }
.plan-header-actions .on, .planning-actions .on { background: var(--bg3); color: var(--text); }
.step.highlighted { background: var(--blue-soft); border-color: var(--blue); }
.remark-count { border: 0; border-radius: var(--radius); color: var(--blue-hover); background: var(--blue-soft); cursor: pointer; }
.plan-tab { flex: 1; overflow: hidden; display: flex; flex-direction: column; min-height: 0; }

.planning-bar { display: flex; align-items: center; gap: 12px; padding: 8px 20px; border-bottom: 1px solid var(--border); background: var(--bg); flex-shrink: 0; }
.planning-status { display: flex; align-items: center; gap: 8px; font-size: var(--fs-md); font-weight: 600; color: var(--text-muted); }
.planning-status.live { color: var(--warning-text); }
.planning-dot { width: 8px; height: 8px; border-radius: var(--radius-round); background: var(--border-strong); }
.live .planning-dot { background: var(--warning-text); animation: pulse 1.2s ease-in-out infinite; }
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
.planning-meta { font-size: var(--fs-sm); color: var(--text-faint); }
.planning-actions { margin-left: auto; display: flex; gap: 8px; }

.plan-pane { flex: 1; min-width: 0; overflow-y: auto; padding: 20px 24px; display: flex; flex-direction: column; }
.plan-doc :deep(ul) { list-style: none; padding-left: 4px; }
.plan-doc :deep(ul ul) { padding-left: 20px; }
/* [[раздел]] / [[раздел/файл]] in the plan document: the same label as AnalysisLinks in the step list */
.chat-pane { flex: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column; }

.plan-tab-content { flex: 1; overflow-y: auto; padding: 16px 20px; display: flex; flex-direction: column; gap: 12px; }

.plan-panel-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.plan-header-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }

.plan-waiting { flex: 1; display: flex; align-items: center; justify-content: center; text-align: center; color: var(--text-muted); font-size: var(--fs-md); min-height: 120px; }

.progress-line { display: flex; align-items: center; gap: 8px; font-size: var(--fs-sm); color: var(--text-muted); flex: 1; }
.progress-bar { flex: 1; height: 4px; background: var(--bg3); border-radius: var(--radius-xs); overflow: hidden; }
.progress-fill { height: 100%; background: var(--accent); transition: width var(--motion-slow); }

.steps { display: flex; flex-direction: column; gap: 3px; }
.step { display: flex; align-items: center; gap: 10px; font-size: var(--fs-md); padding: 7px 10px; border-radius: var(--radius-sm); cursor: pointer; transition: background var(--motion-fast), border-color var(--motion-fast); border: 1px solid transparent; }
.step:hover { background: var(--bg3); }
.step.done { color: var(--text-muted); }
.step.done .step-text { text-decoration: line-through; text-decoration-color: var(--text-faint); }
.step-check { width: 18px; height: 18px; border: 1.5px solid var(--border-strong); border-radius: var(--radius-5); background: none; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: var(--fs-xs); flex-shrink: 0; color: white; transition: background var(--motion-fast), border-color var(--motion-fast); }
.step-check.done { background: var(--accent); border-color: var(--accent); }
.step-check.readonly { cursor: default; }
.step-check.readonly:not(.done):hover { background: none; border-color: var(--border-strong); }
.step-id { font-size: var(--fs-xs); color: var(--text-muted); font-family: var(--font-mono); flex-shrink: 0; }
.step-text { flex: 1; }
.parallel-badge { font-size: var(--fs-xs); color: var(--blue); background: var(--blue-soft); padding: 1px 6px; border-radius: var(--radius); white-space: nowrap; }

.plan-editor-wrap { display: flex; flex-direction: column; gap: 8px; flex: 1; min-height: 0; }
.plan-editor {
  background: var(--bg3);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text);
  font-family: var(--font-mono);
  font-size: var(--fs-md);
  padding: 10px;
  flex: 1;
  min-height: 200px;
  resize: none;
}
.plan-editor:focus { outline: none; border-color: var(--blue); }
.plan-editor-helper { display: flex; flex-direction: column; gap: 8px; color: var(--text-muted); font-size: var(--fs-xs); line-height: 1.4; }
.plan-editor-helper > span code, .plan-editor-helper code {
  font-family: var(--font-mono);
  background: var(--bg3);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-4);
  padding: 1px 5px;
  color: var(--text);
}
.checkbox-preview { display: flex; gap: 6px; flex-wrap: wrap; }
.checkbox-line {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  padding: 4px 8px 4px 6px;
  background: var(--bg2);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.checkbox-line code { flex-shrink: 0; border-color: var(--blue); color: var(--blue-hover); background: var(--blue-soft); font-weight: 600; }
.plan-actions { display: flex; gap: 8px; }
</style>


