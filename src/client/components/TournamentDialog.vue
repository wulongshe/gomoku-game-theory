<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useIntervalFn } from '@vueuse/core'
import AppDialog from '~/components/AppDialog.vue'
import DialogButton from '~/components/DialogButton.vue'
import IconSpinner from '~/components/icons/IconSpinner.vue'
import { fetchTournament, registerTournament, withdrawTournament } from '~/apis'
import { useAuth } from '~/composables/useAuth'
import { useCountdown } from '~/composables/useCountdown'
import { formatCountdown } from '~/utils/format'
import type { TournamentInfo } from '@/shared/protocol'

const emit = defineEmits<{ close: []; login: [] }>()

const { loggedIn } = useAuth()
const info = ref<TournamentInfo | null>(null)
const busy = ref(false)
const loading = ref(true)

// 服务端时钟偏移校正后再倒计时。
const startDeadline = ref<number | null>(null)
const startLeft = useCountdown(startDeadline)

async function load() {
  try {
    const data = await fetchTournament()
    info.value = data
    startDeadline.value = Date.now() + (data.startsAt - data.now)
  } catch {
    // 静默：保留上次数据
  } finally {
    loading.value = false
  }
}

onMounted(load)
useIntervalFn(load, 3000)

async function act() {
  if (!loggedIn.value) return emit('login')
  const i = info.value
  if (!i) return
  if (i.participating) return location.assign('/tournament') // 参赛者点击后才进入大厅
  busy.value = true
  try {
    info.value = i.registered ? await withdrawTournament() : await registerTournament()
  } catch {
    // ignore
  } finally {
    busy.value = false
  }
}

const buttonText = computed(() => {
  if (!loggedIn.value) return '登录后参加'
  const i = info.value
  if (!i) return '加载中…'
  if (i.participating) return '进入'
  const next = i.state === 'active' // 进行中报的是下一场
  if (i.registered) return next ? '取消报名（下一场）' : '取消报名'
  return next ? '报名下一场' : '报名'
})
const buttonVariant = computed(() =>
  loggedIn.value && !info.value?.participating && info.value?.registered ? 'secondary' : 'primary',
)
</script>

<template>
  <AppDialog title="每日大赛" @close="emit('close')">
    <div v-if="loading && !info" class="flex justify-center py-6">
      <IconSpinner class="size-5 text-stone-400" />
    </div>
    <div v-else-if="info" class="flex flex-col gap-4">
      <div class="rounded-xl bg-stone-100 px-4 py-3 text-center dark:bg-stone-700/50">
        <template v-if="info.participating">
          <p class="text-sm text-stone-500 dark:text-stone-400">
            第 {{ info.round }} / {{ info.totalRounds }} 轮进行中
          </p>
          <p class="mt-1 text-2xl font-bold text-stone-800 tabular-nums dark:text-stone-100">
            {{ info.playerCount }} 人参赛
          </p>
        </template>
        <template v-else>
          <p class="text-sm text-stone-500 dark:text-stone-400">
            {{ info.state === 'active' ? '大赛进行中 · 距下一场' : '距开赛' }}
          </p>
          <p class="mt-1 text-2xl font-bold text-stone-800 tabular-nums dark:text-stone-100">
            {{ formatCountdown(startLeft ?? 0) }}
          </p>
          <p class="mt-1 text-xs text-stone-400 dark:text-stone-500">
            {{ info.state === 'active' ? '报名参加明天的大赛' : `每日 20:00 · 已报名 ${info.playerCount} 人` }}
          </p>
        </template>
      </div>

      <div v-if="info.standings.length" class="flex flex-col gap-1.5">
        <p class="text-xs text-stone-400 dark:text-stone-500">
          {{ info.state === 'active' ? '实时积分' : '上届排名' }}
        </p>
        <div class="flex max-h-48 flex-col gap-1 overflow-y-auto">
          <div
            v-for="(row, i) in info.standings"
            :key="row.email"
            class="flex items-center gap-2 rounded-lg bg-stone-100 px-3 py-2 text-sm dark:bg-stone-700/50"
          >
            <span class="min-w-5 text-center font-semibold text-stone-400 dark:text-stone-500">
              {{ i + 1 }}
            </span>
            <span class="min-w-0 flex-1 truncate text-stone-700 dark:text-stone-200">{{ row.email }}</span>
            <span class="font-semibold text-stone-800 tabular-nums dark:text-stone-100">{{ row.score }}</span>
          </div>
        </div>
      </div>
      <p v-else class="text-center text-sm text-stone-500 dark:text-stone-400">
        瑞士轮积分赛 · 报名后到点自动配对开赛
      </p>

      <p v-if="!loggedIn" class="text-center text-xs text-amber-600 dark:text-amber-400">
        仅注册用户可参加
      </p>
    </div>

    <template #footer>
      <DialogButton :variant="buttonVariant" @click="act">
        <IconSpinner v-if="busy" class="size-4" />
        {{ buttonText }}
      </DialogButton>
    </template>
  </AppDialog>
</template>
