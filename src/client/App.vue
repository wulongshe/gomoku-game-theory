<script setup lang="ts">
import { ref } from 'vue'
import { BOARD_SIZE, FRAME_SECONDS } from '@/engine/game'

const status = ref('')

async function createRoom() {
  const res = await fetch('/api/rooms', { method: 'POST' })
  const { code } = (await res.json()) as { code: string }
  status.value = `房间已创建:${code}`
}
</script>

<template>
  <main class="flex min-h-dvh flex-col items-center justify-center gap-6 bg-stone-100 p-6">
    <h1 class="text-3xl font-bold text-stone-800">同步五子棋</h1>
    <p class="text-stone-600">{{ BOARD_SIZE }}×{{ BOARD_SIZE }} 棋盘 · 每帧 {{ FRAME_SECONDS }} 秒同时落子</p>
    <button
      class="rounded-lg bg-stone-800 px-6 py-3 text-lg text-white active:bg-stone-600"
      @click="createRoom"
    >
      创建房间
    </button>
    <p class="text-sm text-stone-500">{{ status }}</p>
  </main>
</template>
