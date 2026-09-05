<script setup lang="ts">
import { computed } from 'vue'
import type { PlayerStatus, Standing } from '@/shared/protocol'

const props = defineProps<{
  standings: Standing[]
  // 我在榜中的下标，由服务端在脱敏前定位（脱敏邮箱撞车时客户端匹配不可靠）。
  me?: number | null
  // 普通行底色随宿主背景而定：弹窗内用 stone、大厅灰底页面上用白色。
  rowClass?: string
}>()

const STATUS_META: Record<PlayerStatus, { label: string; dot: string }> = {
  idle: { label: '空闲中', dot: 'bg-stone-400' },
  matching: { label: '匹配中', dot: 'bg-amber-400' },
  readying: { label: '准备中', dot: 'bg-purple-500' },
  playing: { label: '对局中', dot: 'bg-emerald-500' },
  cooldown: { label: '冷却中', dot: 'bg-sky-400' },
  left: { label: '已离开', dot: 'bg-red-400' },
}

// 仅实时积分带状态（上届排名不带），有状态才显示图例与着色。
const hasStatus = computed(() => props.standings.some((row) => row.status))

const MEDALS = ['🥇', '🥈', '🥉']
</script>

<template>
  <div class="flex min-h-0 flex-col gap-1.5">
    <div
      v-if="hasStatus"
      class="flex items-start justify-center gap-2.5 text-xs text-stone-500 dark:text-stone-400"
    >
      <span v-for="item in STATUS_META" :key="item.label" class="flex flex-col items-center gap-1">
        <span class="size-2 rounded-full" :class="item.dot" />
        {{ item.label }}
      </span>
    </div>
    <div class="flex min-h-0 flex-col gap-1 overflow-y-auto overscroll-contain">
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
        <span
          v-if="row.status"
          class="size-2 shrink-0 rounded-full"
          :class="STATUS_META[row.status].dot"
        />
        <span class="min-w-5 shrink-0 text-center">
          <template v-if="i < MEDALS.length">{{ MEDALS[i] }}</template>
          <span v-else class="font-semibold text-stone-400 dark:text-stone-500">{{ i + 1 }}</span>
        </span>
        <span
          class="min-w-0 flex-1 overflow-x-auto whitespace-nowrap text-stone-700 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden dark:text-stone-200"
        >{{ row.email }}</span>
        <span class="min-w-8 text-center font-semibold text-stone-800 tabular-nums dark:text-stone-100">
          {{ row.score }}
        </span>
      </div>
    </div>
  </div>
</template>
