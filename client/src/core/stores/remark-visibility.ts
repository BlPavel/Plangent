import { defineStore } from 'pinia'
import { ref, watch } from 'vue'

/** A display preference shared by all review surfaces; never changes review data. */
export const useRemarkVisibilityStore = defineStore('remark-visibility', () => {
  const key = 'plangent:show-closed-remarks'
  let saved = false
  try { saved = localStorage.getItem(key) === '1' } catch { /* storage unavailable */ }
  const showClosed = ref(saved)
  watch(showClosed, value => {
    try { localStorage.setItem(key, value ? '1' : '0') } catch { /* storage unavailable */ }
  }, { flush: 'sync' })
  return { showClosed }
})
