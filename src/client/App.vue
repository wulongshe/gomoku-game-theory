<script setup lang="ts">
import HomeView from './HomeView.vue'
import RoomView from './RoomView.vue'

const code = location.pathname.match(/^\/r\/([A-Z0-9]{6})$/)?.[1] ?? null
</script>

<template>
  <RoomView v-if="code" :code="code" />
  <HomeView v-else />
</template>
