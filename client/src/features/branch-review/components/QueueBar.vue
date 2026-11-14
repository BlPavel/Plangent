<template>
  <div v-if="pending" class="qb">
    <span class="qb-text">Ждут отправки агенту: {{ pending }} {{ plural(pending, 'разговор', 'разговора', 'разговоров') }}</span>
    <AppButton size="xs" variant="ghost" :disabled="busy || sending" :title="busy ? 'Агент отвечает: дождитесь конца ответа' : 'Отправить агенту всё написанное одним сообщением'" @click="send">{{ sending ? 'Отправка…' : 'Отправить агенту' }}</AppButton>
  </div>
</template>
<script setup lang="ts">
import AppButton from '@shared/ui/AppButton.vue'
import { useAppStore } from '@core/stores/app'
import { errorText } from '@shared/utils/errorText'
import { computed, ref } from 'vue'
import { branchReviewApi } from '../api'
import { useReviewAgent } from '../composables/useReviewAgent'
import { plural } from '../utils'

/** What the developer wrote to the agent in remarks and threads waits here: one button sends it all. */
const props = defineProps<{ screenKey: string; scope: string; reviewId: string; head: string }>()
const app = useAppStore()
const { screen, busy } = useReviewAgent(props.screenKey, computed(() => props.head))
const sending = ref(false)
const pending = computed(() => new Set(screen.messages.filter(m => m.author === 'developer' && !m.sent).map(m => m.question_id)).size)
async function send() {
  if (sending.value) return
  sending.value = true
  try {
    const result = await branchReviewApi.send(props.scope, props.reviewId, {})
    screen.questions = result.questions; screen.messages = result.messages; screen.thread = result.thread
  } catch (cause) { app.toast(errorText(cause), 'error') } finally { sending.value = false }
}
</script>
<style scoped>
.qb { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: 0 10px 6px; padding: 6px 8px; border: 1px dashed var(--blue); border-radius: var(--radius-sm); background: var(--blue-soft); font-size: var(--fs-sm); }
.qb-text { color: var(--blue-hover); }
</style>
