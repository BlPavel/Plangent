<template>
  <div class="plan-tab">
    <!-- Planning with an agent: plan on the left, chat on the right, header always visible -->
    <template v-if="!readonly && (planningActive || planningDraft)">
      <header class="planning-bar">
        <div class="planning-status" :class="{ live: planningActive }">
          <span class="planning-dot" />
          {{ planningActive ? 'Идёт планирование с агентом' : 'Новое планирование' }}
        </div>
        <span v-if="plan?.steps.length" class="planning-meta">{{ plan.steps.length }} {{ stepsWord(plan.steps.length) }}</span>
        <div class="planning-actions">
          <AppButton v-if="!planningActive" variant="ghost" size="sm" @click="$emit('cancelPlanning')">Отмена</AppButton>
          <AppButton
            variant="primary"
            size="sm"
            :disabled="!planningActive || !plan?.steps.length"
            :title="plan?.steps.length ? 'Закрыть сессию агента и зафиксировать план' : 'Плана пока нет'"
            @click="$emit('approvePlan')"
          >✓ Утвердить план</AppButton>
        </div>
      </header>

      <div ref="split" class="planning-split" :class="{ dragging }">
        <section class="plan-pane" :style="{ flexBasis: `${share}%` }">
          <MessageMarkdown v-if="planText" class="plan-doc" :text="planText" />
          <div v-else class="plan-waiting">
            {{ planningActive ? 'Ожидаем план от агента…' : 'План появится здесь, когда агент его составит' }}
          </div>
        </section>
        <div
          class="splitter"
          role="separator"
          aria-orientation="vertical"
          title="Потяните, чтобы изменить ширину. Двойной клик — поровну"
          @pointerdown="startDrag"
          @dblclick="setShare(50)"
        />
        <aside class="chat-pane">
          <ChatView v-if="planningSessionId" :session-id="planningSessionId" :initial-content="planningInitial" :draft-text="planningMessage" />
          <NewChatPanel
            v-else
            :project-id="projectId"
            :default-agent-id="defaultAgentId"
            title="Планирование"
            :text="plan ? 'Скажите, что изменить в плане. Агент изучит код и обновит план — в проекте он ничего не меняет.' : 'Опишите задачу — агент изучит код и составит план. В проекте он ничего не меняет, план появится слева.'"
            :placeholder="plan ? 'Что изменить в плане…' : 'Опишите задачу…  @ — файл'"
            fixed-policy="read-only"
            :initial-text="planningMessage"
            :busy="planningLaunching"
            :error="planningError"
            @start="$emit('launchPlanning', $event)"
          />
        </aside>
      </div>
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
        <textarea
          :value="planContent"
          @input="$emit('update:planContent', ($event.target as HTMLTextAreaElement).value)"
          class="plan-editor"
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
          <AppButton variant="ghost" size="sm" @click="$emit('openPlanning')">▸ Изменить план с агентом</AppButton>
          <AppButton variant="ghost" size="sm" @click="$emit('togglePlanEdit')">Редактировать вручную</AppButton>
        </div>
      </div>
      <div class="steps">
        <div v-for="s in plan!.steps" :key="s.id ?? s.index" class="step" :class="{ done: s.done }">
          <span class="step-check readonly" :class="{ done: s.done }">{{ s.done ? '✓' : '' }}</span>
          <span class="step-id" v-if="s.id">{{ s.id }}</span>
          <span class="step-text"><AnalysisLinks :text="s.text" /></span>
          <span v-if="s.parallelGroup" class="parallel-badge">параллельно: {{ s.parallelGroup }}</span>
        </div>
      </div>
    </div>
  </div>
</template>
<script setup lang="ts">
import { computed, ref } from 'vue'
import AnalysisLinks from './AnalysisLinks.vue'
import { ChatView, NewChatPanel, MessageMarkdown, type NewChatRequest, type ContentBlock } from '@features/agent-chat'
import AppButton from '@shared/ui/AppButton.vue'
import type { Plan } from '@core/models'

const props = defineProps<{
  readonly?: boolean
  planningMessage?: string
  plan: Plan | null
  projectId: string
  defaultAgentId?: string | null
  planningActive: boolean
  planningDraft: boolean
  planningSessionId: string | null
  planningInitial?: ContentBlock[]
  planningLaunching: boolean
  planningError: string
  editingPlan: boolean
  planContent: string
  checkboxLinePreviews: { marker: string; text: string }[]
  doneCount: number
  progressPct: number
}>()
defineEmits<{
  approvePlan: []
  openPlanning: []
  cancelPlanning: []
  launchPlanning: [request: NewChatRequest]
  startManualEdit: []
  togglePlanEdit: []
  savePlan: []
  cancelEdit: []
  'update:planContent': [v: string]
}>()

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

// ── Plan / chat split: dragged by the developer, remembered between visits ──
const SHARE_KEY = 'plangent.planningShare'
const split = ref<HTMLElement>()
const dragging = ref(false)
const share = ref(readShare())
function readShare() {
  try { const saved = Number(localStorage.getItem(SHARE_KEY)); return saved >= 20 && saved <= 80 ? saved : 50 } catch { return 50 }
}
function setShare(value: number) {
  share.value = Math.min(80, Math.max(20, Math.round(value * 10) / 10))
  try { localStorage.setItem(SHARE_KEY, String(share.value)) } catch { /* storage unavailable */ }
}
function startDrag(event: PointerEvent) {
  const handle = event.currentTarget as HTMLElement
  const box = split.value!.getBoundingClientRect()
  handle.setPointerCapture(event.pointerId)
  dragging.value = true
  const move = (e: PointerEvent) => setShare(((e.clientX - box.left) / box.width) * 100)
  const stop = () => {
    dragging.value = false
    handle.removeEventListener('pointermove', move)
    handle.removeEventListener('pointerup', stop)
    handle.removeEventListener('pointercancel', stop)
  }
  handle.addEventListener('pointermove', move)
  handle.addEventListener('pointerup', stop)
  handle.addEventListener('pointercancel', stop)
}
</script>
<style scoped>
.plan-tab { flex: 1; overflow: hidden; display: flex; flex-direction: column; min-height: 0; }

.planning-bar { display: flex; align-items: center; gap: 12px; padding: 8px 20px; border-bottom: 1px solid var(--border); background: var(--bg); flex-shrink: 0; }
.planning-status { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; color: var(--text-muted); }
.planning-status.live { color: #e3b341; }
.planning-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--border-strong); }
.live .planning-dot { background: #e3b341; animation: pulse 1.2s ease-in-out infinite; }
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
.planning-meta { font-size: 12px; color: var(--text-faint); }
.planning-actions { margin-left: auto; display: flex; gap: 8px; }

.planning-split { flex: 1; min-height: 0; display: flex; }
.planning-split.dragging { cursor: col-resize; user-select: none; }
.plan-pane { flex-grow: 0; flex-shrink: 0; min-width: 0; overflow-y: auto; padding: 20px 24px; display: flex; flex-direction: column; }
.plan-doc :deep(ul) { list-style: none; padding-left: 4px; }
.plan-doc :deep(ul ul) { padding-left: 20px; }
/* [[раздел]] / [[раздел/файл]] in the plan document: the same label as AnalysisLinks in the step list */
.plan-doc :deep(button.btn[data-analysis-target]) { height: 19px; margin: 0 1px; padding: 0 6px; vertical-align: 1px; border: 1px solid var(--blue-soft); border-radius: 5px; background: var(--blue-soft); color: var(--blue-hover); font-family: 'Cascadia Code', 'JetBrains Mono', monospace; font-size: 11.5px; font-weight: 400; }
.plan-doc :deep(button.btn[data-analysis-target]:not(:disabled):hover) { border-color: var(--blue-hover); }
.plan-doc :deep(button.btn[data-analysis-target]:disabled) { opacity: 1; border-style: dashed; border-color: var(--danger); background: var(--danger-soft); color: var(--danger-hover) !important; text-decoration: line-through; }
.chat-pane { flex: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column; }
.splitter { position: relative; width: 1px; flex-shrink: 0; background: var(--border); cursor: col-resize; touch-action: none; }
.splitter::before { content: ''; position: absolute; inset: 0 -4px; }
.splitter:hover, .dragging .splitter { background: var(--blue); box-shadow: 0 0 0 1px var(--blue); }

.plan-tab-content { flex: 1; overflow-y: auto; padding: 16px 20px; display: flex; flex-direction: column; gap: 12px; }

.plan-panel-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.plan-header-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }

.plan-waiting { flex: 1; display: flex; align-items: center; justify-content: center; text-align: center; color: var(--text-muted); font-size: 13px; min-height: 120px; }

.progress-line { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--text-muted); flex: 1; }
.progress-bar { flex: 1; height: 4px; background: var(--bg3); border-radius: 2px; overflow: hidden; }
.progress-fill { height: 100%; background: var(--accent); transition: width 0.3s; }

.steps { display: flex; flex-direction: column; gap: 3px; }
.step { display: flex; align-items: center; gap: 10px; font-size: 13px; padding: 7px 10px; border-radius: var(--radius-sm); cursor: pointer; transition: background 0.12s, border-color 0.12s; border: 1px solid transparent; }
.step:hover { background: var(--bg3); }
.step.done { color: var(--text-muted); }
.step.done .step-text { text-decoration: line-through; text-decoration-color: var(--text-faint); }
.step-check { width: 18px; height: 18px; border: 1.5px solid var(--border-strong); border-radius: 5px; background: none; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 11px; flex-shrink: 0; color: white; transition: background 0.12s, border-color 0.12s; }
.step-check.done { background: var(--accent); border-color: var(--accent); }
.step-check.readonly { cursor: default; }
.step-check.readonly:not(.done):hover { background: none; border-color: var(--border-strong); }
.step-id { font-size: 10px; color: var(--text-muted); font-family: monospace; flex-shrink: 0; }
.step-text { flex: 1; }
.parallel-badge { font-size: 10px; color: var(--blue); background: rgba(88,166,255,0.12); padding: 1px 6px; border-radius: 8px; white-space: nowrap; }

.plan-editor-wrap { display: flex; flex-direction: column; gap: 8px; flex: 1; min-height: 0; }
.plan-editor {
  background: var(--bg3);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text);
  font-family: 'Cascadia Code', 'JetBrains Mono', monospace;
  font-size: 13px;
  padding: 10px;
  flex: 1;
  min-height: 200px;
  resize: none;
}
.plan-editor:focus { outline: none; border-color: var(--blue); }
.plan-editor-helper { display: flex; flex-direction: column; gap: 8px; color: var(--text-muted); font-size: 11px; line-height: 1.4; }
.plan-editor-helper > span code, .plan-editor-helper code {
  font-family: 'Cascadia Code', 'JetBrains Mono', monospace;
  background: var(--bg3);
  border: 1px solid var(--border-strong);
  border-radius: 4px;
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
