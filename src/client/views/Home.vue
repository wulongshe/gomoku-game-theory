<script setup lang="ts">
import { computed, ref } from 'vue'
import { useTimestamp, useWebSocket } from '@vueuse/core'
import AppButton from '~/components/AppButton.vue'
import IconSpinner from '~/components/icons/IconSpinner.vue'
import IconStones from '~/components/icons/IconStones.vue'
import { createRoom, matchWsUrl } from '~/api'
import { FRAME_SECONDS } from '@/engine/game'
import type { LobbyServerMessage } from '@/shared/protocol'

const creating = ref(false)
const matching = ref(false)
let matched = false

const now = useTimestamp({ interval: 1000 })
const matchStart = ref(0)
const matchSeconds = computed(() => Math.max(0, Math.floor((now.value - matchStart.value) / 1000)))

async function create() {
  creating.value = true
  try {
    location.assign(`/room/${await createRoom()}`)
  } catch {
    creating.value = false
  }
}

const { open: openMatch, close: closeMatch } = useWebSocket(matchWsUrl(), {
  immediate: false,
  onMessage(_, event) {
    const msg = JSON.parse(event.data) as LobbyServerMessage
    if (msg.type === 'matched') {
      matched = true
      location.assign(`/room/${msg.code}`)
    }
  },
  onDisconnected() {
    if (!matched) matching.value = false
  },
})

function toggleMatch() {
  if (matching.value) {
    closeMatch()
    matching.value = false
  } else {
    matching.value = true
    matchStart.value = Date.now()
    openMatch()
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
      <button
        class="w-full cursor-pointer rounded-xl border border-stone-300 bg-white/80 px-6 py-3 text-lg font-medium text-stone-700 shadow-sm transition-transform active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100"
        :disabled="creating"
        @click="toggleMatch"
      >
        <span class="flex items-center justify-center gap-2">
          <IconSpinner v-if="matching" class="size-5" />
          <span>{{ matching ? `匹配中…${matchSeconds}s，点击取消` : '随机匹配' }}</span>
        </span>
      </button>
      <AppButton class="w-full" :disabled="creating || matching" @click="create">
        <span class="flex items-center justify-center gap-2">
          <IconSpinner v-if="creating" class="size-5" />
          <span>{{ creating ? '创建中…' : '创建房间' }}</span>
        </span>
      </AppButton>
      <p class="text-xs text-stone-400">免下载 · 免注册，10 秒开局</p>
    </div>
  </main>
</template>
