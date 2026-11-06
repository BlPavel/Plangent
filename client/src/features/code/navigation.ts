import type { CompareBase } from './stores/code'

/** Route that opens a project on its «Код» tab; `task` adds the «← Задача-N» crumb and files the review under that task. */
export function codeTarget(projectId: string, task?: { id: string; key: string } | null) {
  const query = new URLSearchParams({ project: projectId, tab: 'code' })
  if (task) { query.set('task', task.id); query.set('key', task.key) }
  return `/?${query.toString()}`
}

/** What «Открыть в Коде» of the side panel asks the «Код» screen to show: the file, the line and the comparison. */
export interface CodeOpenRequest { path: string | null; line: number | null; mode: 'diff' | 'file'; base: CompareBase; round: string | null }
const openRequests = new Map<string, CodeOpenRequest>()
const requestKey = (projectId: string, workspaceId: string | null) => projectId + ':' + (workspaceId ?? '')
/** Leaves the request for the screen which is about to mount; it is taken once, like `lastOpened`. */
export function requestCodeOpen(projectId: string, workspaceId: string | null, request: CodeOpenRequest) {
  openRequests.set(requestKey(projectId, workspaceId), request)
}
export function takeCodeOpen(projectId: string, workspaceId: string | null): CodeOpenRequest | undefined {
  const key = requestKey(projectId, workspaceId)
  const request = openRequests.get(key)
  openRequests.delete(key)
  return request
}
