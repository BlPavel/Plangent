import { onServerEvent } from '@core/api/events'
import type { WorkEvent, WorkspaceEvent } from '@contracts'
export const onWorkEvent = (handler: (event: WorkEvent) => void) =>
  onServerEvent(event => { if (['work:update', 'work:ready_for_check', 'work:fixes_ready'].includes(event.type)) handler(event as WorkEvent) })
export const onWorkspaceEvent = (handler: (event: WorkspaceEvent) => void) =>
  onServerEvent(event => { if (['workspace:update', 'workspace:viewing'].includes(event.type)) handler(event as WorkspaceEvent) })
