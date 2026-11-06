import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { onServerEvent } from '@core/api/events'
import type { LibraryItem, LibraryScope } from '@contracts'
import { useAppStore } from '@core/stores/app'
import { useProjectsStore } from '@features/projects'
import { libraryDefaults, libraryEndpoints } from '../api'
import { useLibraryStore } from '../stores/library'

export type InstructionTextType = Parameters<typeof libraryDefaults>[0]

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
  const content = ref(''), saved = ref('')
  const editing = ref(false), loading = ref(false), saving = ref(false)
  const editingBase = ref(''), stale = ref(false)
  const isDirty = computed(() => content.value !== editingBase.value)

  const project = computed(() => options.scope() === 'project' ? projects.byId(options.projectId()) : null)
  const levelName = computed(() => project.value?.kind === 'group' ? 'группы' : 'проекта')
  const effective = computed(() => own.value ? 'own' : inherited.value?.origin ?? 'default')
  const effectiveLabel = computed(() => {
    if (effective.value === 'own') return options.scope() === 'global' ? 'глобальное (своё)' : `своё для ${levelName.value}`
    if (effective.value === 'group') return `от группы «${projects.byId(project.value?.group_id)?.name ?? '—'}»`
    if (effective.value === 'global') return 'глобальное, из настроек'
    return 'предустановленное'
  })
  /** The text in force now, what the read-only view shows and what «Изменить» starts from. */
  const effectiveText = computed(() => own.value ? saved.value : inherited.value?.content ?? defaultText.value)

  // The project list carries each item's origin; the nearest enabled level wins, as on the server.
  let loadRevision = 0
  async function load(preserveEdits = false) {
    const revision = ++loadRevision
    loading.value = true
    try {
      const type = options.type(), scope = options.scope()
      const nextDefault = (await libraryDefaults(type)).content
      const list = scope === 'global'
        ? (await libraryEndpoints.getLibrary({ params: {}, query: { type, scope: 'global' } })).map(i => ({ ...i, origin: 'direct' as const }))
        : await libraryEndpoints.getLibrary({ params: {}, query: { type, forProject: options.projectId() ?? '' } })
      const nextOwn = list.find(i => i.origin === 'direct') ?? null
      const parent = (['group', 'global'] as const).map(origin => list.find(i => i.origin === origin && i.enabled)).find(Boolean)
      const nextInherited = parent
        ? { origin: parent.origin as 'group' | 'global', label: parent.origin === 'group' ? options.groupLabel() : 'глобальное', content: (await store.getItem(parent.id)).content ?? '' }
        : null
      const nextSaved = nextOwn ? (await store.getItem(nextOwn.id)).content ?? '' : ''
      if (revision !== loadRevision) return
      const keepEdits = preserveEdits && editing.value && isDirty.value
      defaultText.value = nextDefault
      own.value = nextOwn
      inherited.value = nextInherited
      saved.value = nextSaved
      if (keepEdits) stale.value = editingBase.value !== effectiveText.value
      else {
        content.value = effectiveText.value
        editingBase.value = effectiveText.value
        editing.value = false
        stale.value = false
      }
    } catch (e) { if (revision === loadRevision) app.toast(String(e), 'error') }
    finally { if (revision === loadRevision) loading.value = false }
  }

  function startEdit() { content.value = editingBase.value = effectiveText.value; editing.value = true; stale.value = false }
  function useDefault() { content.value = defaultText.value }
  function useInherited() { if (inherited.value) content.value = inherited.value.content }
  function cancel() { content.value = saved.value; editing.value = false; stale.value = false }

  async function save() {
    if (stale.value) return
    saving.value = true
    try {
      if (own.value) await libraryEndpoints.putLibraryById({ params: { id: own.value.id }, body: { content: content.value } })
      else {
        const type = options.type(), scope = options.scope()
        own.value = await libraryEndpoints.postLibrary({ params: {}, body: {
          type, slug: type.replaceAll('-', '_'), title: options.itemTitle(), description: '',
          scope, targets: scope === 'project' && options.projectId() ? [options.projectId()!] : [], content: content.value,
        } })
      }
      saved.value = content.value
      editingBase.value = content.value
      editing.value = false
      app.toast(options.savedToast(), 'success')
    } catch (e) { app.toast(String(e), 'error') }
    finally { saving.value = false }
  }

  async function reset() {
    if (!own.value) return
    const next = options.scope() === 'global' ? 'предустановленное' : inherited.value ? inherited.value.label : 'предустановленное'
    if (!(await app.confirm(`${options.resetQuestion()} Будет действовать ${next}.`))) return
    try { await store.remove(own.value.id); await load() }
    catch (e) { app.toast(String(e), 'error') }
  }

  onMounted(() => load())
  watch([options.type, options.scope, options.projectId], () => load())
  onBeforeUnmount(onServerEvent<{ type: string; item?: LibraryItem }>(event => {
    if (event.type === 'library_changed' && (!event.item || event.item.type === options.type())) void load(true)
  }))
  onBeforeUnmount(() => { loadRevision++ })

  return { own, inherited, defaultText, content, editing, loading, saving, isDirty, stale, levelName, effective, effectiveLabel, effectiveText, load, startEdit, useDefault, useInherited, cancel, save, reset }
}
