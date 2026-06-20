import type { RouteRecordRaw } from 'vue-router'

export const taskRoutes: RouteRecordRaw[] = [
  { path: '/task/:id', component: () => import('./views/TaskView.vue') },
]
