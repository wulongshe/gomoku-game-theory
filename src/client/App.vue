<script setup lang="ts">
import AiRoom from './views/AiRoom.vue'
import Home from './views/Home.vue'
import Room from './views/Room.vue'

const code = location.pathname.match(/^\/room\/(\d{4,8})$/)?.[1] ?? null
const ai = location.pathname === '/ai'
</script>

<template>
  <Room v-if="code" :code="code" />
  <AiRoom v-else-if="ai" />
  <Home v-else />
</template>
