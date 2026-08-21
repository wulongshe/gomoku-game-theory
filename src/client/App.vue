<script setup lang="ts">
import Home from './views/Home.vue'
import Room from './views/Room.vue'

const code = location.pathname.match(/^\/r\/([A-Z0-9]{6})$/)?.[1] ?? null
</script>

<template>
  <Room v-if="code" :code="code" />
  <Home v-else />
</template>
