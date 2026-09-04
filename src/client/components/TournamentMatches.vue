<script setup lang="ts">
import type { Match } from '@/shared/protocol'

defineProps<{
  matches: Match[]
  // 行底色随宿主背景而定：弹窗内用 stone、大厅灰底页面上用白色。
  rowClass?: string
}>()
</script>

<template>
  <div class="flex min-h-0 flex-col gap-1 overflow-y-auto overscroll-contain">
    <a
      v-for="(m, i) in matches"
      :key="i"
      :href="`/room/${m.code}?spectate=1`"
      class="flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm transition-colors"
      :class="rowClass ?? 'bg-stone-100 hover:bg-stone-200/70 dark:bg-stone-700/50 dark:hover:bg-stone-700'"
    >
      <span class="min-w-0 flex-1 truncate text-left text-stone-700 dark:text-stone-200">{{ m.a }}</span>
      <span
        class="shrink-0 bg-gradient-to-br from-amber-500 to-red-600 bg-clip-text font-black italic tracking-tight text-transparent"
      >VS</span>
      <span class="min-w-0 flex-1 truncate text-right text-stone-700 dark:text-stone-200">{{ m.b }}</span>
    </a>
    <p
      v-if="!matches.length"
      class="py-8 text-center text-sm text-stone-400 dark:text-stone-500"
    >
      暂无进行中的对局
    </p>
  </div>
</template>
