<script setup lang="ts">
import type { Standing } from '@/shared/protocol'

defineProps<{
  standings: Standing[]
  // 我在榜中的下标，由服务端在脱敏前定位（脱敏邮箱撞车时客户端匹配不可靠）。
  me?: number | null
  // 普通行底色随宿主背景而定：弹窗内用 stone、大厅灰底页面上用白色。
  rowClass?: string
}>()
</script>

<template>
  <div class="flex flex-col gap-1 overflow-y-auto">
    <div
      v-for="(row, i) in standings"
      :key="i"
      class="relative flex items-center gap-3 rounded-xl px-4 py-2.5 text-sm"
      :class="
        i === me
          ? 'sticky top-0 bottom-0 z-10 bg-amber-100 ring-1 ring-inset ring-wood/60 dark:bg-stone-600'
          : (rowClass ?? 'bg-stone-100 dark:bg-stone-700/50')
      "
    >
      <span
        v-if="i === me"
        class="absolute right-0 top-0 rounded-bl-lg rounded-tr-xl bg-wood-deep px-1.5 py-0.5 text-[10px] leading-none text-white"
      >我</span>
      <span class="min-w-5 text-center font-semibold text-stone-400 dark:text-stone-500">
        {{ i + 1 }}
      </span>
      <span class="min-w-0 flex-1 truncate text-stone-700 dark:text-stone-200">{{ row.email }}</span>
      <span class="text-xs text-stone-400 dark:text-stone-500">{{ row.played }} 局</span>
      <span class="min-w-8 text-center font-semibold text-stone-800 tabular-nums dark:text-stone-100">
        {{ row.score }}
      </span>
    </div>
  </div>
</template>
