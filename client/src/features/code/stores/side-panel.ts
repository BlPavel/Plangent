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
  /** Main screen has already picked its initial file, even if all tabs were later closed. */
  initialized?: boolean
}

/** A place is a project plus its work's folder: works in separate folders never share open files, even on same-named branches. */
export const sidePlaceKey = (projectId: string, workspaceId: string | null) => projectId + ':' + (workspaceId ?? '')

/** Open files per place, independently for the main screen and side panel; kept while the application runs. */
export const useSidePanelStore = defineStore('code-side-panel', () => {
  const places = reactive<Record<string, SidePlaceState>>({})
  const mainPlaces = reactive<Record<string, SidePlaceState>>({})

  function place(projectId: string, workspaceId: string | null, target = places): SidePlaceState {
    const key = sidePlaceKey(projectId, workspaceId)
    target[key] ??= { projectId, workspaceId, files: [], active: null, list: 'changes', base: 'head', baseRound: null }
    return target[key]
  }
  const mainPlace = (projectId: string, workspaceId: string | null) => place(projectId, workspaceId, mainPlaces)
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
    for (const target of [places, mainPlaces]) {
      for (const [key, state] of Object.entries(target)) if (state.workspaceId === workspaceId) delete target[key]
    }
  }
  function forgetProject(projectId: string) {
    for (const target of [places, mainPlaces]) {
      for (const [key, state] of Object.entries(target)) if (state.projectId === projectId) delete target[key]
    }
  }

  return { places, mainPlaces, place, mainPlace, open, close, closeAll, forgetWorkspace, forgetProject }
})
