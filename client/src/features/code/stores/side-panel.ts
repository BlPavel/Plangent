import { reactive } from 'vue'
import { defineStore } from 'pinia'
import type { CompareBase } from './code'

export type SideListTab = 'changes' | 'files' | 'search'
export interface SideOpenFile { path: string; mode: 'diff' | 'file' }
/** What the side panel remembers about one place (a project's main folder or a work's folder). */
export interface SidePlaceState {
  projectId: string
  workspaceId: string | null
  files: SideOpenFile[]
  active: string | null
  list: SideListTab
  base: CompareBase
  baseRound: string | null
}

/** A place is a project plus its work's folder: works in separate folders never share open files, even on same-named branches. */
export const sidePlaceKey = (projectId: string, workspaceId: string | null) => projectId + ':' + (workspaceId ?? '')

/** Open files of the side code panel per place; kept while the application runs, like drafts. */
export const useSidePanelStore = defineStore('code-side-panel', () => {
  const places = reactive<Record<string, SidePlaceState>>({})

  function place(projectId: string, workspaceId: string | null): SidePlaceState {
    const key = sidePlaceKey(projectId, workspaceId)
    return places[key] ??= { projectId, workspaceId, files: [], active: null, list: 'changes', base: 'head', baseRound: null }
  }
  /** Opens the file in a new tab next to the current one, or switches to its tab. */
  function open(state: SidePlaceState, path: string, mode: 'diff' | 'file') {
    const found = state.files.find(file => file.path === path)
    if (found) found.mode = mode
    else {
      const at = state.files.findIndex(file => file.path === state.active)
      state.files.splice(at + 1, 0, { path, mode })
    }
    state.active = path
  }
  /** Closing the active tab moves to its neighbour. */
  function close(state: SidePlaceState, path: string) {
    const index = state.files.findIndex(file => file.path === path)
    if (index < 0) return
    state.files.splice(index, 1)
    if (state.active === path) state.active = (state.files[index] ?? state.files[index - 1])?.path ?? null
  }
  function closeAll(state: SidePlaceState) { state.files = []; state.active = null }
  /** A removed work's folder or a deleted project leaves nothing to come back to. */
  function forgetWorkspace(workspaceId: string) {
    for (const [key, state] of Object.entries(places)) if (state.workspaceId === workspaceId) delete places[key]
  }
  function forgetProject(projectId: string) {
    for (const [key, state] of Object.entries(places)) if (state.projectId === projectId) delete places[key]
  }

  return { places, place, open, close, closeAll, forgetWorkspace, forgetProject }
})
