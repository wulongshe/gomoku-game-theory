<script setup lang="ts">
import { computed, ref } from 'vue'
import { useStorage, useTimestamp, useWebSocket } from '@vueuse/core'
import AppButton from '~/components/AppButton.vue'
import RulesDialog from '~/components/RulesDialog.vue'
import IconHelp from '~/components/icons/IconHelp.vue'
import IconSpinner from '~/components/icons/IconSpinner.vue'
import IconStones from '~/components/icons/IconStones.vue'
import { createRoom, matchWsUrl } from '~/apis'
import { MODE_LABELS, RULES, SUBTITLE, TAGLINE, TITLE } from '~/constants/branding'
import { FRAME_OPTIONS, MODE_OPTIONS, type LobbyServerMessage } from '@/shared/protocol'
import type { GameMode } from '@/engine/game'

const creating = ref(false)
const matching = ref(false)
const showRules = ref(false)
let matched = false

const frameSeconds = useStorage('frame-seconds', FRAME_OPTIONS[0])
const gameMode = useStorage<GameMode>('game-mode', MODE_OPTIONS[0])

const now = useTimestamp({ interval: 1000 })
const matchStart = ref(0)
const matchSeconds = computed(() => Math.max(0, Math.floor((now.value - matchStart.value) / 1000)))

async function create() {
  creating.value = true
  try {
    location.assign(`/room/${await createRoom(frameSeconds.value, gameMode.value)}`)
  } catch {
    creating.value = false
  }
}

const { open: openMatch, close: closeMatch } = useWebSocket(
  computed(() => matchWsUrl(frameSeconds.value, gameMode.value)),
  {
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
  },
)

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

</script>

<template>
  <main
    class="relative flex min-h-dvh flex-col items-center justify-center gap-8 bg-gradient-to-b from-stone-100 to-stone-200 p-6"
  >
    <button
      class="absolute right-5 top-5 flex cursor-pointer items-center gap-1.5 rounded-full p-2 text-sm leading-none text-stone-400 transition-colors hover:text-stone-600 active:text-stone-600"
      @click="showRules = true"
    >
      <IconHelp class="size-5 translate-y-[1.5px]" />
      <span>游戏规则</span>
    </button>

    <div class="flex flex-col items-center gap-3">
      <IconStones class="h-8 drop-shadow" />
      <h1 class="text-3xl font-bold tracking-wide text-stone-800">{{ TITLE }}</h1>
      <p class="font-medium text-stone-600">{{ TAGLINE }}</p>
      <p class="text-sm text-stone-500">{{ SUBTITLE }}</p>
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
      <div class="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 pb-1 text-sm">
        <div class="flex items-center gap-3">
          <span class="text-stone-500">每回合</span>
          <div class="flex rounded-lg bg-stone-300/60 p-0.5">
            <button
              v-for="option in FRAME_OPTIONS"
              :key="option"
              class="cursor-pointer rounded-md px-4 py-1 font-medium transition-colors"
              :class="frameSeconds === option ? 'bg-white text-stone-800 shadow-sm' : 'text-stone-500'"
              :disabled="matching"
              @click="frameSeconds = option"
            >
              {{ option }}s
            </button>
          </div>
        </div>
        <div class="flex items-center gap-3">
          <span class="text-stone-500">撞点成</span>
          <div class="flex rounded-lg bg-stone-300/60 p-0.5">
            <button
              v-for="option in MODE_OPTIONS"
              :key="option"
              class="cursor-pointer rounded-md px-4 py-1 font-medium transition-colors"
              :class="gameMode === option ? 'bg-white text-stone-800 shadow-sm' : 'text-stone-500'"
              :disabled="matching"
              @click="gameMode = option"
            >
              {{ MODE_LABELS[option] }}
            </button>
          </div>
        </div>
      </div>
      <AppButton secondary class="w-full" :disabled="creating" @click="toggleMatch">
        <span class="flex items-center justify-center gap-2">
          <IconSpinner v-if="matching" class="size-5" />
          <span>{{ matching ? `匹配中…${matchSeconds}s，点击取消` : '随机匹配' }}</span>
        </span>
      </AppButton>
      <AppButton class="w-full" :disabled="creating || matching" @click="create">
        <span class="flex items-center justify-center gap-2">
          <IconSpinner v-if="creating" class="size-5" />
          <span>{{ creating ? '创建中…' : '创建房间' }}</span>
        </span>
      </AppButton>
      <p class="text-xs text-stone-400">免下载 · 免注册，10 秒开局</p>
    </div>

    <RulesDialog v-if="showRules" @close="showRules = false" />
  </main>
</template>
