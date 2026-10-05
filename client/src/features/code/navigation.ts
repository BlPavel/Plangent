/** Route that opens a project on its «Код» tab; `task` adds the «← Задача-N» crumb and files the review under that task. */
export function codeTarget(projectId: string, task?: { id: string; key: string } | null) {
  const query = new URLSearchParams({ project: projectId, tab: 'code' })
  if (task) { query.set('task', task.id); query.set('key', task.key) }
  return `/?${query.toString()}`
}
