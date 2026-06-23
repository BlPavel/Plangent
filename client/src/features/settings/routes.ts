import type { RouteRecordRaw } from 'vue-router'

export const settingsRoutes: RouteRecordRaw[] = [
  { path: '/settings', component: () => import('./views/SettingsView.vue') },
]
