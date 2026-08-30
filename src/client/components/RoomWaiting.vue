<script setup lang="ts">
import { ref } from 'vue'
import { useClipboard } from '@vueuse/core'
import AppButton from '~/components/AppButton.vue'
import SharePoster from '~/components/SharePoster.vue'
import type { GameMode } from '@/engine/game'

defineProps<{ code: string; url: string; frameSeconds: number; mode: GameMode }>()

const posterEl = ref<InstanceType<typeof SharePoster> | null>(null)
const { copy, copied, isSupported: copySupported } = useClipboard({ legacy: true })
</script>

<template>
  <div class="flex w-full flex-1 flex-col items-center justify-center gap-5">
    <div
      class="flex w-full max-w-sm flex-col items-center gap-4 rounded-2xl bg-white/80 p-8 shadow-sm backdrop-blur dark:bg-stone-800/80"
    >
      <p class="text-sm text-stone-500 dark:text-stone-400">房间号</p>
      <p class="text-4xl font-bold tracking-[0.3em] text-stone-800 dark:text-stone-100">{{ code }}</p>
      <p class="flex items-center gap-2 text-sm text-stone-500 dark:text-stone-400">
        <span
          class="size-2 animate-[breathe_1.2s_ease-in-out_infinite] rounded-full bg-amber-400"
        />
        等待对方加入…
      </p>
      <SharePoster
        ref="posterEl"
        :url="url"
        :code="code"
        :frame-seconds="frameSeconds"
        :mode="mode"
        class="h-auto w-64 rounded-xl shadow-md"
      />
      <p class="text-sm text-stone-500 dark:text-stone-400">对方扫码或打开链接即可开始</p>
      <div class="flex w-full gap-2">
        <AppButton v-if="copySupported" class="flex-1" @click="copy(url)">
          {{ copied ? '已复制 ✓' : '复制链接' }}
        </AppButton>
        <AppButton secondary class="flex-1" @click="posterEl?.share()">分享海报</AppButton>
      </div>
      <p
        v-if="!copySupported"
        class="max-w-full rounded-lg bg-stone-100 px-3 py-2 text-xs break-all text-stone-500 select-all dark:bg-stone-700/60 dark:text-stone-400"
      >
        {{ url }}
      </p>
    </div>
  </div>
</template>
