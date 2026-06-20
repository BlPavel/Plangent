import { createRouter, createWebHistory } from 'vue-router'
import HomeView from '@/views/HomeView.vue'
import TaskView from '@/views/TaskView.vue'
import AgentsView from '@/views/AgentsView.vue'
import SkillsView from '@/views/SkillsView.vue'

export default createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: HomeView },
    { path: '/task/:id', component: TaskView },
    { path: '/agents', component: AgentsView },
    { path: '/skills', component: SkillsView },
  ],
})
