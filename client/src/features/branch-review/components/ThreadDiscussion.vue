<template>
  <AgentDiscussion
    :screen-key="screenKey" :scope="scope" :review-id="reviewId" :thread-id="thread.id" :where="where" :place="{ path: thread.path ?? '', side: thread.side, line: thread.line ?? 0 }"
    placeholder="Например: коллега ответил, прав ли он? Написанное встанет в очередь и уйдёт агенту вместе с остальным. Ctrl+Enter — в очередь"
    hint="Спросить агента об этом обсуждении: например, прав ли коллега в своём ответе"
  />
</template>
<script setup lang="ts">
import type { ExternalThread } from '@features/code'
import AgentDiscussion from './AgentDiscussion.vue'

/** A colleague's GitLab thread talked over with the agent: the conversation sits under the thread, not in the GitLab discussion. */
defineProps<{ thread: ExternalThread; screenKey: string; scope: string; reviewId: string; where?: string }>()
</script>
