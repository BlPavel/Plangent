<template>
  <span class="agent-note" :class="{ missing: !agent }" :title="agent ? 'Меняется в «Инструкции → Коммиты» проекта или в глобальных настройках' : ''">
    <template v-if="agent">Агент: {{ name }}<template v-if="agent.model"> · {{ agent.model }}</template><template v-if="agent.effort"> · рассуждения {{ agent.effort }}</template> · только чтение</template>
    <template v-else>Агент для коммитов и МР не выбран — укажите его в «Инструкции → Коммиты» или в настройках</template>
  </span>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useAgentsStore } from '@features/agents'
import { useGitStore } from '../stores/git'

/** Names the agent that writes commits and MR texts: chosen in the settings, never on these screens. */
const git = useGitStore(), agents = useAgentsStore()
const agent = computed(() => git.settings?.agent ?? null)
const name = computed(() => agents.agents.find(a => a.id === agent.value?.agentId)?.name ?? 'агент проекта')
onMounted(() => { if (!agents.agents.length) void agents.load() })
</script>

<style scoped>
.agent-note { font-size: 11.5px; color: var(--text-faint); overflow-wrap: anywhere; }
.agent-note.missing { color: var(--warning-text); }
</style>
