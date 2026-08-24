<script setup lang="ts">
import { ref } from 'vue'
import AppButton from '~/components/AppButton.vue'
import { createRoom } from '~/api'
import { BOARD_SIZE, FRAME_SECONDS } from '@/engine/game'

const creating = ref(false)

async function create() {
  creating.value = true
  try {
    location.assign(`/room/${await createRoom()}`)
  } catch {
    creating.value = false
  }
}
</script>

<template>
  <main class="flex min-h-dvh flex-col items-center justify-center gap-6 bg-stone-100 p-6">
    <h1 class="text-3xl font-bold text-stone-800">同步五子棋</h1>
    <p class="text-stone-600">{{ BOARD_SIZE }}×{{ BOARD_SIZE }} 棋盘 · 每帧 {{ FRAME_SECONDS }} 秒同时落子</p>
    <AppButton :disabled="creating" @click="create">
      {{ creating ? '创建中…' : '创建房间' }}
    </AppButton>
  </main>
</template>
