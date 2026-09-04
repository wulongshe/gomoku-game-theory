<script setup lang="ts">
import { onMounted, ref } from 'vue'
import AppDialog from '~/components/AppDialog.vue'
import IconSpinner from '~/components/icons/IconSpinner.vue'
import { fetchLeaderboard, type LeaderboardEntry } from '~/apis'

const emit = defineEmits<{ close: [] }>()

const MEDALS = ['🥇', '🥈', '🥉']
const LEGEND = [
  { label: '胜', dot: 'bg-emerald-500' },
  { label: '负', dot: 'bg-red-500' },
  { label: '平', dot: 'bg-stone-400' },
]

const entries = ref<LeaderboardEntry[]>([])
// 我在榜中的下标由服务端在脱敏前定位（脱敏邮箱撞车时客户端匹配不可靠）。
const me = ref<number | null>(null)
const loading = ref(true)
const failed = ref(false)

onMounted(async () => {
  try {
    const board = await fetchLeaderboard()
    entries.value = board.entries
    me.value = board.me
  } catch {
    failed.value = true
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <AppDialog title="排行榜" @close="emit('close')">
    <div v-if="loading" class="flex justify-center py-8">
      <IconSpinner class="size-5 text-stone-400" />
    </div>
    <p v-else-if="failed" class="py-8 text-center text-sm text-stone-500 dark:text-stone-400">
      加载失败，请稍后重试
    </p>
    <p v-else-if="!entries.length" class="py-8 text-center text-sm text-stone-500 dark:text-stone-400">
      还没有注册玩家
    </p>
    <div v-else class="-mx-3 -mb-2 flex flex-col gap-2">
      <div class="flex items-center justify-center gap-4 text-xs text-stone-500 dark:text-stone-400">
        <span v-for="item in LEGEND" :key="item.label" class="flex items-center gap-1.5">
          <span class="size-2 rounded-full" :class="item.dot" />
          {{ item.label }}
        </span>
      </div>
      <div class="flex max-h-80 flex-col gap-2 overflow-y-auto overscroll-contain">
        <div
          v-for="(entry, index) in entries"
          :key="index"
          class="relative flex items-center gap-2 rounded-xl px-3 py-3"
          :class="
            index === me
              ? 'sticky top-0 bottom-0 z-10 bg-amber-100 ring-1 ring-inset ring-wood/60 dark:bg-stone-600'
              : 'bg-stone-100 dark:bg-stone-700/50'
          "
        >
          <span
            v-if="index === me"
            class="absolute right-0 top-0 rounded-bl-lg rounded-tr-xl bg-wood-deep px-1.5 py-0.5 text-[10px] leading-none text-white"
          >我</span>
          <span class="min-w-5 shrink-0 text-center">
            <template v-if="index < MEDALS.length">{{ MEDALS[index] }}</template>
            <span v-else class="text-sm font-semibold text-stone-400 dark:text-stone-500">
              {{ index + 1 }}
            </span>
          </span>
          <div
            class="min-w-0 flex-1 overflow-x-auto whitespace-nowrap text-sm font-medium text-stone-700 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden dark:text-stone-200"
          >
            {{ entry.email }}
          </div>
          <div class="flex shrink-0 items-center gap-1.5 text-sm font-semibold tabular-nums">
            <span class="min-w-4 text-center text-emerald-600 dark:text-emerald-400">
              {{ entry.wins }}
            </span>
            <span class="min-w-4 text-center text-red-500 dark:text-red-400">
              {{ entry.losses }}
            </span>
            <span class="min-w-4 text-center text-stone-400 dark:text-stone-500">
              {{ entry.draws }}
            </span>
          </div>
        </div>
      </div>
    </div>
  </AppDialog>
</template>
