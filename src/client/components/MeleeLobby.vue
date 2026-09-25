<script setup lang="ts">
import { computed } from 'vue'
import { useClipboard } from '@vueuse/core'
import { encode } from 'uqr'
import AppButton from '~/components/AppButton.vue'
import IconCheck from '~/components/icons/IconCheck.vue'
import IconStone from '~/components/icons/IconStone.vue'
import { frameLabel } from '~/utils/format'
import { COLOR_LABELS } from '@gomoku/branding'
import type { Color } from '@gomoku/engine/melee'

const props = defineProps<{
  code: string
  url: string
  frameSeconds: number
  seat: Color
  seats: Color[]
  present: Color[]
  ready: Color[]
}>()
const emit = defineEmits<{ ready: [] }>()

const { copy, copied, isSupported: copySupported } = useClipboard({ legacy: true })

const myReady = computed(() => props.ready.includes(props.seat))
const missing = computed(() => props.seats.length - props.present.length)
const hint = computed(() =>
  missing.value > 0 ? `还差 ${missing.value} 人，把链接发给好友…` : myReady.value ? '等待其他人准备…' : '人齐了，全员准备后开局',
)

const qr = computed(() => encode(props.url, { border: 0 }))
const qrPath = computed(() => {
  let d = ''
  qr.value.data.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (dark) d += `M${x} ${y}h1v1h-1z`
    }),
  )
  return d
})

const slots = computed(() =>
  props.seats.map((color) => ({
    color,
    label: color === props.seat ? `你执${COLOR_LABELS[color]}` : `${COLOR_LABELS[color]}方`,
    present: props.present.includes(color),
    ready: props.ready.includes(color),
  })),
)
</script>

<template>
  <div class="flex w-full flex-1 flex-col items-center justify-center">
    <div
      class="flex w-full max-w-sm flex-col items-center gap-4 rounded-2xl bg-white/80 p-8 shadow-sm backdrop-blur dark:bg-stone-800/80"
    >
      <p class="text-sm text-stone-500 dark:text-stone-400">中秋特辑 · 房间号</p>
      <p class="text-4xl font-bold tracking-[0.3em] text-stone-800 dark:text-stone-100">{{ code }}</p>
      <p class="flex items-center gap-2 text-sm text-stone-500 dark:text-stone-400">
        <span class="size-2 animate-[breathe_1.2s_ease-in-out_infinite] rounded-full bg-amber-400" />
        {{ hint }}
      </p>
      <span class="rounded-full bg-stone-100 px-2.5 py-1 text-xs text-stone-500 dark:bg-stone-700/60 dark:text-stone-400">
        {{ seats.length }} 人 · 每回合 {{ frameLabel(frameSeconds) }} · 19 路
      </span>
      <div class="flex w-full flex-col gap-2">
        <div
          v-for="slot in slots"
          :key="slot.color"
          class="flex items-center justify-between rounded-xl bg-stone-100 px-4 py-3 dark:bg-stone-700/50"
        >
          <span class="flex items-center gap-2 text-sm font-medium text-stone-700 dark:text-stone-200">
            <IconStone :seat="slot.color" mooncake class="size-4" />
            {{ slot.label }}
          </span>
          <span
            class="flex items-center gap-1 text-sm font-medium"
            :class="!slot.present ? 'text-stone-400 dark:text-stone-500' : slot.ready ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'"
          >
            <IconCheck class="size-3.5" :class="!(slot.present && slot.ready) && 'invisible'" />
            {{ !slot.present ? '等待加入' : slot.ready ? '已准备' : '未准备' }}
          </span>
        </div>
      </div>
      <template v-if="missing > 0">
        <svg
          :viewBox="`0 0 ${qr.size} ${qr.size}`"
          class="size-36 rounded-lg bg-white p-2"
          shape-rendering="crispEdges"
          aria-label="房间二维码"
        >
          <path :d="qrPath" fill="#292524" />
        </svg>
        <AppButton v-if="copySupported" class="w-full" @click="copy(url)">
          {{ copied ? '已复制 ✓' : '复制链接' }}
        </AppButton>
        <p
          v-else
          class="max-w-full rounded-lg bg-stone-100 px-3 py-2 text-xs break-all text-stone-500 select-all dark:bg-stone-700/60 dark:text-stone-400"
        >
          {{ url }}
        </p>
      </template>
      <AppButton v-else class="w-full" :disabled="myReady" @click="emit('ready')">
        {{ myReady ? '已准备，等待其他人…' : '准备' }}
      </AppButton>
    </div>
  </div>
</template>
