import type { RouteRecordRaw } from 'vue-router'

export const projectRoutes: RouteRecordRaw[] = [
  { path: '/', component: () => import('./views/HomeView.vue') },
]
