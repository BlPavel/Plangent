import { onBeforeUnmount, onMounted, type Ref } from 'vue'
import { useComposerTargetsStore } from '../stores/composer-targets'

/**
 * A screen whose chat may be folded away or not started tells «В чат» how to show the message field.
 * `root` decides whether the screen is the one on view (tabs stay mounted behind `v-show`).
 */
export function useComposerReveal(
  root: Ref<HTMLElement | undefined | null>,
  scope: () => { projectId: string; workspaceId?: string | null },
  show: () => void | Promise<void>,
) {
  const targets = useComposerTargetsStore()
  let remove: (() => void) | null = null
  onMounted(() => {
    remove = targets.addReveal({
      projectId: () => scope().projectId,
      workspaceId: () => scope().workspaceId ?? null,
      visible: () => !!root.value && root.value.getClientRects().length > 0,
      show,
    })
  })
  onBeforeUnmount(() => remove?.())
}
