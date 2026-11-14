import { createRouter, createWebHistory } from 'vue-router'
import { agentRoutes } from '@features/agents'
import { libraryRoutes } from '@features/library'
import { projectRoutes } from '@features/projects'
import { settingsRoutes } from '@features/settings'
import { taskRoutes } from '@features/tasks'

export default createRouter({
  history: createWebHistory(),
  routes: [
    ...projectRoutes,
    ...taskRoutes,
    ...settingsRoutes,
    ...agentRoutes,
    ...libraryRoutes,
  ],
})
