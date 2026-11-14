<template>
  <FloatingPanel :model-value="modelValue" title="Как рисовать схемы" :width="680" @update:model-value="$emit('update:modelValue', $event)">
    <div class="guide">
      <AppSegmented v-model="selected" :options="options" label="Пример схемы" />
      <p class="guide-hint">{{ current.hint }}</p>
      <div class="guide-grid">
        <AppTextarea v-model="code" mono block class="guide-code" aria-label="Код схемы" spellcheck="false" />
        <MessageMarkdown class="guide-result" :text="fenced" />
      </div>
      <footer class="guide-actions">
        <span class="guide-note">Код можно менять: результат справа обновится.</span>
        <AppButton v-if="canInsert" variant="primary" size="sm" @click="$emit('insert', code)">Вставить в документ</AppButton>
      </footer>
    </div>
  </FloatingPanel>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import AppButton from '@shared/ui/AppButton.vue'
import AppSegmented from '@shared/ui/AppSegmented.vue'
import AppTextarea from '@shared/ui/AppTextarea.vue'
import FloatingPanel from '@shared/ui/FloatingPanel.vue'
import { MessageMarkdown } from '@features/agent-chat'

defineProps<{ modelValue: boolean; canInsert: boolean }>()
defineEmits<{ 'update:modelValue': [value: boolean]; insert: [code: string] }>()

const examples = [
  {
    value: 'layers', label: 'Слои',
    hint: 'flowchart TD рисует сверху вниз (LR — слева направо). Узел появляется при первом упоминании, форма задаётся скобками: [текст], (скруглённый), [(база)], {условие}.',
    code: 'flowchart TD\n  Client[Клиент] --> API[HTTP API]\n  API --> Core[Core]\n  Core --> DB[(SQLite)]\n  Core --> Git[Git]',
  },
  {
    value: 'new', label: 'Новое и старое',
    hint: 'Новые части отличайте цветом: classDef задаёт стиль, ::: применяет его. Подпись на стрелке — A -->|текст| B.',
    code: 'flowchart TD\n  API[HTTP API] -->|вызывает| Core[Core]\n  Core --> Review[Review]:::new\n  Core --> DB[(SQLite)]\n  classDef new fill:#1f3d2b,stroke:#4caf70,color:#fff',
  },
  {
    value: 'groups', label: 'Группы',
    hint: 'subgraph рисует рамку вокруг связанных частей. Связи между узлами из разных групп пишутся отдельными строками.',
    code: 'flowchart TD\n  subgraph client[Клиент]\n    View[Экран] --> Store[Стор]\n  end\n  subgraph server[Сервер]\n    API[HTTP API] --> Core[Core]\n  end\n  Store --> API',
  },
  {
    value: 'sequence', label: 'Вызовы',
    hint: 'sequenceDiagram показывает порядок обращений во времени. ->> обычная стрелка, -->> ответ.',
    code: 'sequenceDiagram\n  participant C as Клиент\n  participant A as API\n  participant K as Core\n  C->>A: POST /work\n  A->>K: создать\n  K-->>A: готово\n  A-->>C: 201',
  },
  {
    value: 'state', label: 'Состояния',
    hint: 'stateDiagram-v2 описывает состояния и переходы. [*] — начало и конец.',
    code: 'stateDiagram-v2\n  [*] --> Draft\n  Draft --> Running: запуск\n  Running --> Done: успех\n  Running --> Failed: ошибка\n  Done --> [*]',
  },
  {
    value: 'grid', label: 'Сетка',
    hint: 'Узлы без связей flowchart ставит в один ряд. Когда нужна раскладка без связей или стрелки вправо и влево, берите block-beta: columns задаёт число колонок, space оставляет пустую ячейку.',
    code: 'block-beta\n  columns 3\n  mods["Новые модули"] core["Core"] git["Git"]\n  space db[("SQLite")] space\n  mods --> core\n  core --> git\n  core --> db',
  },
]
const options = examples.map(({ value, label }) => ({ value, label }))
const selected = ref(examples[0].value)
const current = computed(() => examples.find(example => example.value === selected.value) ?? examples[0])
const code = ref(current.value.code)
watch(current, example => { code.value = example.code })
const fenced = computed(() => '```mermaid\n' + code.value + '\n```')
</script>

<style scoped>
.guide { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: var(--sp-3); padding: var(--sp-3) var(--sp-4) var(--sp-4); overflow-y: auto; }
.guide-hint { font-size: var(--fs-md); color: var(--text-muted); line-height: var(--lh-normal); }
.guide-grid { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr); gap: var(--sp-3); }
.guide-code { min-height: 200px; }
.guide-result { min-width: 0; overflow: auto; }
.guide-actions { display: flex; align-items: center; justify-content: space-between; gap: var(--sp-3); }
.guide-note { font-size: var(--fs-sm); color: var(--text-faint); }
</style>
