import { computed, onScopeDispose, ref, watch } from 'vue'
import { api } from '@core/api'
import type { SuggestItem } from '../components/SuggestMenu.vue'

export interface MentionFile { path: string; dir: boolean; uri: string; ref?: boolean; section?: SuggestItem['section']; detail?: string }

/** The chat and review composers share file/source search and menu rows. */
export function useMentionFiles(projectId: () => string | null) {
  const files = ref<MentionFile[]>([])
  const loading = ref(false)
  let request = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  const suggestions = computed<SuggestItem[]>(() => files.value.map(file => {
    const path = file.dir ? file.path.slice(0, -1) : file.path
    const cut = path.lastIndexOf('/') + 1
    return { value: file.path, prefix: path.slice(0, cut), label: path.slice(cut) + (file.dir ? '/' : ''),
      dir: file.dir, ref: file.ref, section: file.section, detail: file.detail }
  }))
  function clear() {
    clearTimeout(timer); request++
    files.value = []; loading.value = false
  }
  function search(query: string) {
    clearTimeout(timer)
    const project = projectId()
    const revision = ++request
    files.value = []
    if (!project) { loading.value = false; return }
    loading.value = true
    timer = setTimeout(async () => {
      try {
        const rows = await api.get<MentionFile[]>('/projects/' + project + '/mentions?q=' + encodeURIComponent(query))
        if (revision === request && project === projectId()) files.value = rows
      } catch { if (revision === request) files.value = [] }
      finally { if (revision === request) loading.value = false }
    }, query ? 70 : 0)
  }
  watch(projectId, clear)
  onScopeDispose(clear)
  return { files, suggestions, loading, search, clear }
}
