import { ref, watch, type Ref } from 'vue'
import { projectsEndpoints } from '../api'

/** The agent the settings name for code review: the project's own choice, else its group's, else the global one. */
export interface ReviewAgentChoice { agentId: string; model: string; effort: string; policy: string }

/** Review agent of a project from its settings; `choice` is null when none is named there, `loaded` — once the answer is known. */
export function useReviewAgentChoice(projectId: () => string): { choice: Ref<ReviewAgentChoice | null>; loaded: Ref<boolean>; load: () => Promise<void> } {
  const choice = ref<ReviewAgentChoice | null>(null), loaded = ref(false)
  async function load() {
    const id = projectId()
    try {
      const { values } = await projectsEndpoints.gitSettings({ params: { id } })
      if (id !== projectId()) return
      choice.value = values.review_agent_id ? { agentId: values.review_agent_id, model: values.review_agent_model, effort: values.review_agent_effort, policy: values.review_agent_policy } : null
    } catch { if (id === projectId()) choice.value = null }
    if (id === projectId()) loaded.value = true
  }
  watch(projectId, () => { choice.value = null; loaded.value = false; void load() }, { immediate: true })
  return { choice, loaded, load }
}
