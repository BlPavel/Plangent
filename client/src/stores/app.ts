import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Project, Task } from '@/api/types'

export const useAppStore = defineStore('app', () => {
  const currentProject = ref<Project | null>(null)
  const currentTask = ref<Task | null>(null)
  const toasts = ref<Array<{ id: number; msg: string; type: string }>>([])
  let toastId = 0

  function toast(msg: string, type: 'info' | 'success' | 'error' = 'info') {
    const id = ++toastId
    toasts.value.push({ id, msg, type })
    setTimeout(() => { toasts.value = toasts.value.filter(t => t.id !== id) }, 4000)
  }

  return { currentProject, currentTask, toasts, toast }
})
