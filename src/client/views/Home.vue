<script setup lang="ts">
import { ref } from 'vue'
import AppButton from '~/components/AppButton.vue'
import IconStones from '~/components/icons/IconStones.vue'
import { createRoom } from '~/api'
import { FRAME_SECONDS } from '@/engine/game'

const creating = ref(false)

async function create() {
  creating.value = true
  try {
    location.assign(`/room/${await createRoom()}`)
  } catch {
    creating.value = false
  }
}

const RULES = [
  {
    icon: '⚡',
    title: '同时落子，没有先手',
    text: `每回合 ${FRAME_SECONDS} 秒同时出手，公平对决，拼的是判断`,
  },
  {
    icon: '🧠',
    title: '撞子成禁，读心制胜',
    text: '双方落同一点，作废变禁点，猜透对方才能抢下要点',
  },
  {
    icon: '⭐',
    title: '五连即胜，零门槛',
    text: '规则你早就会：连成五子就赢，上手只要 10 秒',
  },
]
</script>

<template>
  <main
    class="flex min-h-dvh flex-col items-center justify-center gap-8 bg-gradient-to-b from-stone-100 to-stone-200 p-6"
  >
    <div class="flex flex-col items-center gap-3">
      <IconStones class="h-8 drop-shadow" />
      <h1 class="text-3xl font-bold tracking-wide text-stone-800">同步五子棋</h1>
      <p class="font-medium text-stone-600">下棋，更是读心</p>
      <p class="text-sm text-stone-500">经典五子棋 × 同时落子，每一手都是心理博弈</p>
    </div>

    <div class="flex w-full max-w-md flex-col gap-2">
      <div
        v-for="rule in RULES"
        :key="rule.title"
        class="flex items-center gap-4 rounded-xl bg-white/80 px-5 py-3.5 shadow-sm backdrop-blur"
      >
        <span
          class="flex size-9 shrink-0 items-center justify-center rounded-full bg-wood/30 text-base leading-none"
        ><span class="block">{{ rule.icon }}</span></span>
        <div>
          <p class="text-sm font-semibold text-stone-800">{{ rule.title }}</p>
          <p class="text-xs text-stone-500">{{ rule.text }}</p>
        </div>
      </div>
    </div>

    <div class="flex w-full max-w-md flex-col items-center gap-2">
      <AppButton class="w-full" :disabled="creating" @click="create">
        {{ creating ? '创建中…' : '开一局，让对手猜猜你的下一手' }}
      </AppButton>
      <p class="text-xs text-stone-400">免下载 · 免注册 · 复制链接发给朋友，10 秒开局</p>
    </div>
  </main>
</template>
