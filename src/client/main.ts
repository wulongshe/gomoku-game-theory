import './assets/main.css'
import { createApp } from 'vue'
import App from './App.vue'

window.addEventListener('pageshow', (event) => {
  if (event.persisted) location.reload()
})

createApp(App).mount('#app')
