<script setup lang="ts">
import { ref } from 'vue'
import { BOARD_SIZE, FRAME_SECONDS } from '@/engine/game'

const creating = ref(false)

async function createRoom() {
  creating.value = true
  try {
    const res = await fetch('/api/rooms', { method: 'POST' })
    const { code } = (await res.json()) as { code: string }
    location.assign(`/room/${code}`)
  } catch {
    creating.value = false
  }
}
</script>

<template>
  <main class="flex min-h-dvh flex-col items-center justify-center gap-6 bg-stone-100 p-6">
    <h1 class="text-3xl font-bold text-stone-800">同步五子棋</h1>
    <p class="text-stone-600">{{ BOARD_SIZE }}×{{ BOARD_SIZE }} 棋盘 · 每帧 {{ FRAME_SECONDS }} 秒同时落子</p>
    <button
      class="rounded-lg bg-stone-800 px-6 py-3 text-lg text-white active:bg-stone-600 disabled:opacity-50"
      :disabled="creating"
      @click="createRoom"
    >
      {{ creating ? '创建中…' : '创建房间' }}
    </button>
  </main>
</template>
