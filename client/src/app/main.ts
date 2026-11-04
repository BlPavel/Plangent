import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import '@shared/ui/styles/tokens.css'
import '@shared/ui/styles/base.css'

createApp(App).use(createPinia()).use(router).mount('#app')
