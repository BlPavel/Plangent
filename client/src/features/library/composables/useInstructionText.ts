import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { onServerEvent } from '@core/api/events'
import type { LibraryItem, LibraryScope } from '@contracts'
import { useAppStore } from '@core/stores/app'
import { useProjectsStore } from '@features/projects'
import { libraryEndpoints } from '../api'
import type { TextInstructionType } from '../../../../../common/library-registry'
import { useDraft } from '@core/composables/useDraft'
import { useLibraryStore } from '../stores/library'

export type InstructionTextType = TextInstructionType

export interface InstructionTextOptions {
  type: () => InstructionTextType
  scope: () => LibraryScope
  projectId: () => string | undefined
  /** Name of the item the editor creates, and its fixed slug. */
  itemTitle: () => string
  /** What the text is called when the group provides it: «инструкция группы», «руководство группы». */
  groupLabel: () => string
  savedToast: () => string
  resetQuestion: () => string
}

/**
 * The state of one text instruction (guide, code-fixer rules, commit rules, review instructions,
 * templates): the nearest level wins — project, group, global — and the built-in text is the last resort.
 */
export function useInstructionText(options: InstructionTextOptions) {
  const app = useAppStore(), store = useLibraryStore(), projects = useProjectsStore()

  const own = ref<LibraryItem | null>(null)
  const inherited = ref<{ origin: 'group' | 'global'; label: string; content: string } | null>(null)
  const defaultText = ref('')
  const draft = useDraft(() => `library:text:${options.scope()}:${options.scope() === 'project' ? options.projectId() : ''}:${options.type()}`, () => ({ content: '', base: '', version: '', editing: false }))
  const content = computed({ get: () => draft.value.content, set: value => { draft.value.content = value } })
  const editing = computed({ get: () => draft.value.editing, set: value => { draft.value.editing = value } })
  const editingBase = computed({ get: () => draft.value.base, set: value => { draft.value.base = value } })
  const saved = ref(''), stale = ref(false)
  const loading = ref(false), saving = ref(false)
  const effective = ref<'own' | 'group' | 'global' | 'default'>('default')
  const effectiveText = ref('')
  const sourceName = ref<string | null>(null)
  const sourceVersion = ref('')
  const isDirty = computed(() => content.value !== editingBase.value)

  const project = computed(() => options.scope() === 'project' ? projects.byId(options.projectId()) : null)
  const levelName = computed(() => project.value?.kind === 'group' ? 'группы' : 'проекта')
  const effectiveLabel = computed(() => {
    if (effective.value === 'own') return options.scope() === 'global' ? 'глобальное (своё)' : `своё для ${levelName.value}`
    if (effective.value === 'group') return `от группы «${sourceName.value ?? '—'}»`
    if (effective.value === 'global') return 'глобальное, из настроек'
    return 'предустановленное'
  })
  // The server resolves availability, enabled and inheritance in a single response.
  let loadRevision = 0
  let loadedDraft: typeof draft.value | undefined
  async function load(preserveEdits = false) {
    const revision = ++loadRevision
    if (loadedDraft !== draft.value) {
      own.value = null
      inherited.value = null
      defaultText.value = effectiveText.value = ''
      effective.value = 'default'
    }
    loading.value = true
    try {
      const result = await libraryEndpoints.getInstructionText({ params: {}, query: {
        type: options.type(), scope: options.scope(), projectId: options.scope() === 'project' ? options.projectId() : undefined,
      } })
      if (revision !== loadRevision) return
      loadedDraft = draft.value
      const keepEdits = preserveEdits && editing.value && isDirty.value
      defaultText.value = result.default_content
      own.value = result.own
      inherited.value = result.inherited ? {
        origin: result.inherited.source.level as 'group' | 'global',
        label: result.inherited.source.level === 'group' ? options.groupLabel() : 'глобальное', content: result.inherited.content,
      } : null
      saved.value = result.own?.content ?? ''
      effective.value = result.source.level
      sourceName.value = result.source.name
      effectiveText.value = result.content
      sourceVersion.value = JSON.stringify({ content: result.content, source: result.source, own: result.own })
      if (keepEdits) stale.value = draft.value.version !== sourceVersion.value
      else {
        content.value = effectiveText.value
        editingBase.value = effectiveText.value
        draft.value.version = sourceVersion.value
        editing.value = false
        stale.value = false
      }
    } catch (e) { if (revision === loadRevision) app.toast(String(e), 'error') }
    finally { if (revision === loadRevision) loading.value = false }
  }

  function startEdit() {
    if (loading.value || loadedDraft !== draft.value) return
    content.value = editingBase.value = effectiveText.value
    draft.value.version = sourceVersion.value
    editing.value = true
    stale.value = false
  }
  function useDefault() { content.value = defaultText.value }
  function useInherited() { if (inherited.value) content.value = inherited.value.content }
  function cancel() { content.value = saved.value; editing.value = false; stale.value = false }

  async function save() {
    if (stale.value || loading.value || saving.value || loadedDraft !== draft.value) return
    const currentDraft = draft.value
    const submitted = content.value
    const item = own.value
    const type = options.type(), scope = options.scope(), projectId = options.projectId()
    saving.value = true
    try {
      if (item) await libraryEndpoints.putLibraryById({ params: { id: item.id }, body: { content: submitted } })
      else {
        await libraryEndpoints.postLibrary({ params: {}, body: {
          type, slug: type.replaceAll('-', '_'), title: options.itemTitle(), description: '',
          scope, targets: scope === 'project' && projectId ? [projectId] : [], content: submitted,
        } })
      }
      if (currentDraft.content === submitted) Object.assign(currentDraft, { editing: false, base: submitted })
      if (draft.value === currentDraft) await load(true)
      app.toast(options.savedToast(), 'success')
    } catch (e) { app.toast(String(e), 'error') }
    finally { saving.value = false }
  }

  async function reset() {
    if (!own.value || loading.value || loadedDraft !== draft.value) return
    const item = own.value
    const currentDraft = draft.value
    const next = options.scope() === 'global' ? 'предустановленное' : inherited.value ? inherited.value.label : 'предустановленное'
    if (!(await app.confirm(`${options.resetQuestion()} Будет действовать ${next}.`))) return
    try { await store.remove(item.id); if (draft.value === currentDraft) await load() }
    catch (e) { app.toast(String(e), 'error') }
  }

  onMounted(() => load(true))
  watch([options.type, options.scope, options.projectId], () => load(true), { flush: 'sync' })
  onBeforeUnmount(onServerEvent<{ type: string; item?: LibraryItem }>(event => {
    if (event.type === 'library_changed') void load(true)
  }))
  onBeforeUnmount(() => { loadRevision++ })

  return { own, inherited, defaultText, content, editing, loading, saving, isDirty, stale, levelName, effective, effectiveLabel, effectiveText, load, startEdit, useDefault, useInherited, cancel, save, reset }
}
