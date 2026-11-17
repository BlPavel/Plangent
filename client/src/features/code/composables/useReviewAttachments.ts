import { ref } from 'vue'
import { useDraft } from '@core/composables/useDraft'
import { projectsEndpoints } from '@features/projects'

/** Uploaded files are named in the review text so the agent can open them, just as in the initial remark. */
export function useReviewAttachments(draftKey: () => string) {
  const files = useDraft<{ name: string; path: string }[]>(draftKey, () => [])
  const uploading = ref(false), attachError = ref('')
  async function attach(list: File[]) {
    if (!list.length || uploading.value) return
    const target = files.value
    uploading.value = true; attachError.value = ''
    try {
      for (const file of list) {
        const data = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(String(reader.result))
          reader.onerror = reject
          reader.readAsDataURL(file)
        })
        const name = file.name || 'скриншот.png'
        const { path } = await projectsEndpoints.postUploadTemp({ params: {}, body: { data, name } })
        target.push({ name, path })
      }
    } catch (cause) { attachError.value = 'Не удалось приложить файл: ' + (cause instanceof Error ? cause.message : String(cause)) }
    finally { uploading.value = false }
  }
  function onPaste(event: ClipboardEvent) {
    if (event.clipboardData?.files.length) { event.preventDefault(); void attach(Array.from(event.clipboardData.files)) }
  }
  function picked(event: Event) {
    const input = event.target as HTMLInputElement
    void attach(Array.from(input.files ?? []))
    input.value = ''
  }
  const attachedText = () => files.value.map(file => '📎 ' + file.name + ': ' + file.path).join('\n')
  return { files, uploading, attachError, onPaste, picked, attachedText }
}
