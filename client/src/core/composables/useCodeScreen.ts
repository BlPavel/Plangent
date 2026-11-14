import { onMounted, onUnmounted } from 'vue'
import { useAppStore } from '@core/stores/app'

/** Marks screens which already occupy the center with code, for their mounted lifetime. */
export function useCodeScreen() {
  const app = useAppStore()
  onMounted(() => { app.codeScreenCount++ })
  onUnmounted(() => { app.codeScreenCount-- })
}
