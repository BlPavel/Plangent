<template>
  <div class="plan-tab">
    <!-- Planning in progress (agent session live) -->
    <div v-if="planningActive" class="plan-panel plan-tab-content">
      <section>
        <div class="plan-panel-header">
          <div class="planning-status">
            <span class="planning-dot" />
            Идёт планирование с агентом
          </div>
          <AppButton variant="primary" size="sm" @click="$emit('approvePlan')">✓ Утвердить план</AppButton>
        </div>
        <p class="plan-empty-hint">
          Опишите задачу агенту в терминале ниже — работают <code>@файлы</code>, перетаскивание и вставка.
          План появится здесь по мере написания. Когда план готов — нажмите «Утвердить».
        </p>
        <textarea v-if="plan?.content" :value="plan.content" class="plan-editor" readonly />
        <div v-else class="plan-waiting">Ожидаем план от агента…</div>
      </section>
      <aside><ChatView v-if="planningSessionId" :session-id="planningSessionId" /></aside>
    </div>

    <!-- Empty state — no plan yet -->
    <div v-else-if="!plan && !editingPlan" class="plan-tab-content">
      <div class="plan-panel-header">
        <div class="progress-line"><span>Плана пока нет</span></div>
        <div class="plan-header-actions">
          <AppSelect :model-value="planningAgentId" @update:model-value="$emit('update:planningAgentId', $event)" :options="agentOptions" placeholder="Агент" size="sm" />
          <AppSelect v-if="planningModelChoices.length" :model-value="planningModel" @update:model-value="$emit('update:planningModel', $event)" :options="planningModelChoices" placeholder="Модель" size="sm" />
          <AppSelect v-if="planningReasoningChoices.length" :model-value="planningReasoning" @update:model-value="$emit('update:planningReasoning', $event)" :options="planningReasoningChoices" placeholder="Рассуждения" size="sm" />
          <AppButton variant="primary" size="sm" :disabled="!planningAgentId || planningLaunching" @click="$emit('launchPlanning')">
            {{ planningLaunching ? 'Запуск...' : '▸ Составить план с агентом' }}
          </AppButton>
          <AppButton variant="ghost" size="sm" @click="$emit('startManualEdit')">Написать вручную</AppButton>
        </div>
      </div>
      <p class="plan-empty-hint">опишите задачу агенту в терминале — работают <code>@файлы</code>, перетаскивание и вставка файлов</p>
    </div>

    <!-- Plan editor (manual) -->
    <div v-else-if="editingPlan" class="plan-tab-content">
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
        <div class="plan-header-actions">
          <AppSelect :model-value="planningAgentId" @update:model-value="$emit('update:planningAgentId', $event)" :options="agentOptions" placeholder="Агент" size="sm" />
          <AppSelect v-if="planningModelChoices.length" :model-value="planningModel" @update:model-value="$emit('update:planningModel', $event)" :options="planningModelChoices" placeholder="Модель" size="sm" />
          <AppSelect v-if="planningReasoningChoices.length" :model-value="planningReasoning" @update:model-value="$emit('update:planningReasoning', $event)" :options="planningReasoningChoices" placeholder="Рассуждения" size="sm" />
          <AppButton variant="ghost" size="sm" :disabled="!planningAgentId || planningLaunching" @click="$emit('launchPlanning')">
            {{ planningLaunching ? 'Запуск...' : '▸ Изменить план с агентом' }}
          </AppButton>
          <AppButton variant="ghost" size="sm" @click="$emit('togglePlanEdit')">Редактировать вручную</AppButton>
        </div>
      </div>
      <div class="steps">
        <div v-for="s in plan!.steps" :key="s.id ?? s.index" class="step" :class="{ done: s.done }">
          <span class="step-check readonly" :class="{ done: s.done }">{{ s.done ? '✓' : '' }}</span>
          <span class="step-id" v-if="s.id">{{ s.id }}</span>
          <span class="step-text">{{ s.text }}</span>
          <span v-if="s.parallelGroup" class="parallel-badge">параллельно: {{ s.parallelGroup }}</span>
        </div>
      </div>
    </div>
  </div>
</template>
<script setup lang="ts">
import { ChatView } from '@features/agent-chat'
import AppButton from '@shared/ui/AppButton.vue'
import AppSelect from '@shared/ui/AppSelect.vue'
import type { Plan } from '@core/models'

defineProps<{
  plan: Plan | null
  planningActive: boolean
  planningSessionId: string | null
  editingPlan: boolean
  planContent: string
  checkboxLinePreviews: { marker: string; text: string }[]
  doneCount: number
  progressPct: number
  agentOptions: { value: string; label: string }[]
  planningAgentId: string
  planningModelChoices: { value: string; label: string }[]
  planningModel: string
  planningReasoningChoices: { value: string; label: string }[]
  planningReasoning: string
  planningLaunching: boolean
}>()
defineEmits<{
  approvePlan: []
  launchPlanning: []
  startManualEdit: []
  togglePlanEdit: []
  savePlan: []
  cancelEdit: []
  'update:planContent': [v: string]
  'update:planningAgentId': [v: string]
  'update:planningModel': [v: string]
  'update:planningReasoning': [v: string]
}>()
</script>
<style scoped>
.plan-tab { flex: 1; overflow: hidden; display: flex; flex-direction: column; min-height: 0; }
.plan-panel { display: grid; grid-template-columns: 1fr 1fr; min-height: 450px; height: 100%; gap: 12px; }
.plan-panel section { min-width: 0; overflow: auto; display: flex; flex-direction: column; }
.plan-panel aside { min-width: 0; min-height: 0; border-left: 1px solid var(--border); }

.plan-empty-hint { font-size: 12px; color: var(--text-muted); margin: 0; }

.plan-tab-content { flex: 1; overflow-y: auto; padding: 16px 20px; display: flex; flex-direction: column; gap: 12px; }

.plan-panel-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.plan-header-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }

.planning-status { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; color: #e3b341; }
.planning-dot { width: 8px; height: 8px; border-radius: 50%; background: #e3b341; animation: pulse 1.2s ease-in-out infinite; }
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }

.plan-waiting { flex: 1; display: flex; align-items: center; justify-content: center; color: var(--text-muted); font-size: 13px; min-height: 120px; }

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
