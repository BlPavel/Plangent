import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Project, Task } from '@core/models'

export interface ToastAction { label: string; run: () => void }

export const useAppStore = defineStore('app', () => {
  const currentProject = ref<Project | null>(null)
  const currentTask = ref<Task | null>(null)
  const toasts = ref<Array<{ id: number; msg: string; type: string; action?: ToastAction }>>([])
  let toastId = 0

  function toast(msg: string, type: 'info' | 'success' | 'error' | 'warning' = 'info', action?: ToastAction) {
    const id = ++toastId
    toasts.value.push({ id, msg, type, action })
    // A toast with a button is a prompt, not a status line: it stays longer.
    setTimeout(() => { toasts.value = toasts.value.filter(t => t.id !== id) }, action ? 12000 : 4000)
  }

  function dismissToast(id: number) {
    toasts.value = toasts.value.filter(t => t.id !== id)
  }

  interface ConfirmOptions {
    title?: string
    confirmLabel?: string
    cancelLabel?: string
    danger?: boolean
  }
  const confirmState = ref<(ConfirmOptions & { message: string }) | null>(null)
  let confirmResolve: ((v: boolean) => void) | null = null

  function confirm(message: string, opts: ConfirmOptions = {}): Promise<boolean> {
    return new Promise((resolve) => {
      confirmResolve?.(false)
      confirmState.value = { message, ...opts }
      confirmResolve = resolve
    })
  }

  function resolveConfirm(result: boolean) {
    confirmResolve?.(result)
    confirmResolve = null
    confirmState.value = null
  }

  return { currentProject, currentTask, toasts, toast, dismissToast, confirmState, confirm, resolveConfirm }
})
