import { defineStore } from 'pinia'
import { ref } from 'vue'
import { api } from '@core/api'
import { platform, type UpdateState } from '@core/platform'
import { useAppStore } from '@core/stores/app'

interface ActiveQueue { projectId: string; taskId: string; taskKey: string }

/** What the restart is doing once confirmed: stopping the backend, then handing over to the installer. */
export type InstallStage = 'stopping' | 'launching'

/**
 * Self-update of the installed app. The shell checks and downloads on its own; this store mirrors
 * its state and asks before a restart that would stop executing queues.
 */
export const useUpdatesStore = defineStore('updates', () => {
  const updates = platform.updates
  const state = ref<UpdateState>({ status: 'idle' })
  const installing = ref<{ version: string; stage: InstallStage } | null>(null)
  let started = false

  function start() {
    if (!updates || started) return
    started = true
    updates.onState(next => { state.value = next })
    void updates.getState().then(next => { state.value = next })
  }

  async function install() {
    if (!updates || state.value.status !== 'ready') return
    let active: ActiveQueue[] = []
    try { active = await api.get<ActiveQueue[]>('/queues/active') } catch { /* ask as if nothing runs */ }
    if (active.length) {
      const ok = await useAppStore().confirm(
        `Сейчас выполняются задачи: ${active.map(q => q.taskKey).join(', ')}. Перезапуск остановит их — после обновления очередь можно будет запустить снова.`,
        { title: 'Перезапустить для обновления?', confirmLabel: 'Перезапустить', cancelLabel: 'Позже' },
      )
      if (!ok) return
    }
    // The window is about to close: say so instead of letting it vanish mid-click.
    installing.value = { version: state.value.version, stage: 'stopping' }
    try {
      await updates.install()
    } catch { /* the shell quits anyway */ }
    if (installing.value) installing.value = { ...installing.value, stage: 'launching' }
  }

  const openRelease = () => updates?.openRelease()

  return { state, installing, start, install, openRelease }
})
