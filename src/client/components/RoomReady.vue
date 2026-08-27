<script setup lang="ts">
import { computed } from 'vue'
import AppButton from '~/components/AppButton.vue'
import IconCheck from '~/components/icons/IconCheck.vue'
import IconStone from '~/components/icons/IconStone.vue'
import { frameLabel, MODE_LABELS } from '~/constants/branding'
import type { GameMode, Seat } from '@/engine/game'

const props = defineProps<{
  code: string
  frameSeconds: number
  mode: GameMode
  seat: Seat
  myReady: boolean
  oppReady: boolean
  oppLeft: boolean
}>()
const emit = defineEmits<{ ready: [] }>()

const HINTS = ['对方已离开，等待对方回来…', '等待对方准备…', '对方已加入，双方准备后开局']
const hint = computed(() =>
  props.oppLeft ? HINTS[0] : props.myReady ? HINTS[1] : HINTS[2],
)

const players = computed(() => [
  {
    label: props.seat === 'black' ? '你执黑' : '你执白',
    seat: props.seat,
    ready: props.myReady,
    left: false,
  },
  {
    label: props.seat === 'black' ? '对方执白' : '对方执黑',
    seat: props.seat === 'black' ? ('white' as const) : ('black' as const),
    ready: props.oppReady,
    left: props.oppLeft,
  },
])
</script>

<template>
  <div class="flex flex-1 flex-col items-center justify-center gap-5">
    <div
      class="flex w-full max-w-md flex-col items-center gap-4 rounded-2xl bg-white/80 p-8 shadow-sm backdrop-blur dark:bg-stone-800/80"
    >
      <p class="text-sm text-stone-500 dark:text-stone-400">房间号</p>
      <p class="text-4xl font-bold tracking-[0.3em] text-stone-800 dark:text-stone-100">{{ code }}</p>
      <div class="flex items-center gap-2 text-xs text-stone-500 dark:text-stone-400">
        <span class="rounded-full bg-stone-100 px-2.5 py-1 dark:bg-stone-700/60">每回合 {{ frameLabel(frameSeconds) }}</span>
        <span class="rounded-full bg-stone-100 px-2.5 py-1 dark:bg-stone-700/60">{{ MODE_LABELS[mode] }}模式</span>
      </div>
      <div class="flex w-full flex-col gap-2">
        <div
          v-for="player in players"
          :key="player.label"
          class="flex items-center justify-between rounded-xl bg-stone-100 px-4 py-3 dark:bg-stone-700/50"
        >
          <span class="flex items-center gap-2 text-sm font-medium text-stone-700 dark:text-stone-200">
            <IconStone :seat="player.seat" class="size-3.5" />
            {{ player.label }}
          </span>
          <span
            class="flex items-center gap-1 text-sm font-medium"
            :class="player.left ? 'text-red-500 dark:text-red-400' : player.ready ? 'text-emerald-600 dark:text-emerald-400' : 'text-stone-400 dark:text-stone-500'"
          >
            <IconCheck class="size-3.5" :class="!(player.ready && !player.left) && 'invisible'" />
            {{ player.left ? '已离开' : player.ready ? '已准备' : '未准备' }}
          </span>
        </div>
      </div>
      <AppButton class="w-full" :disabled="myReady" @click="emit('ready')">
        {{ myReady ? '已准备，等待对方…' : '准备' }}
      </AppButton>
    </div>
    <div class="grid">
      <p
        v-for="text in HINTS"
        :key="text"
        class="col-start-1 row-start-1 flex items-center justify-center gap-2 text-sm text-stone-500 transition-opacity dark:text-stone-400"
        :class="text !== hint && 'opacity-0'"
      >
        <span
          class="size-2 animate-[breathe_1.2s_ease-in-out_infinite] rounded-full"
          :class="oppLeft ? 'bg-red-500' : 'bg-amber-400'"
        />
        {{ text }}
      </p>
    </div>
  </div>
</template>
