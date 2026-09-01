<script setup lang="ts">
import { computed, ref } from 'vue'
import { useWebSocket } from '@vueuse/core'
import AppDialog from '~/components/AppDialog.vue'
import DialogButton from '~/components/DialogButton.vue'
import TournamentStandings from '~/components/TournamentStandings.vue'
import IconSpinner from '~/components/icons/IconSpinner.vue'
import { registerTournament, tournamentWsUrl, withdrawTournament } from '~/apis'
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
const roundDeadline = ref<number | null>(null)
const roundLeft = useCountdown(roundDeadline)

function apply(data: TournamentInfo) {
  info.value = data
  startDeadline.value = Date.now() + (data.startsAt - data.now)
  roundDeadline.value =
    data.roundDeadline === null ? null : Date.now() + (data.roundDeadline - data.now)
  loading.value = false
}

// 服务端连上即推一帧、状态变化再推，无需轮询。
useWebSocket(tournamentWsUrl(), {
  heartbeat: {
    message: 'ping',
    responseMessage: 'pong',
    interval: 20_000,
    pongTimeout: 10_000,
  },
  autoReconnect: { delay: 3000 },
  onMessage(_ws, event) {
    apply(JSON.parse(event.data as string) as TournamentInfo)
  },
})

async function act() {
  if (!loggedIn.value) return emit('login')
  const i = info.value
  if (!i) return
  if (i.participating) return location.assign('/tournament') // 参赛者点击后才进入大厅
  busy.value = true
  try {
    apply(i.registered ? await withdrawTournament() : await registerTournament())
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
    <div v-else-if="info" class="-mx-3 -mb-2 flex flex-col gap-4">
      <div class="rounded-xl bg-stone-100 px-4 py-3 text-center dark:bg-stone-700/50">
        <template v-if="info.participating">
          <p class="text-sm text-stone-500 dark:text-stone-400">
            第 {{ info.round }} / {{ info.totalRounds }} 轮 · 本轮剩余
          </p>
          <p class="mt-1 text-2xl font-bold text-stone-800 tabular-nums dark:text-stone-100">
            {{ formatCountdown(roundLeft ?? 0) }}
          </p>
          <p class="mt-1 text-xs text-stone-400 dark:text-stone-500">{{ info.playerCount }} 人参赛</p>
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
        <p class="mt-1 text-xs text-stone-400 dark:text-stone-500">约3轮 · 每轮10min · 每回合10~30s</p>
      </div>

      <div v-if="info.standings.length" class="flex flex-col gap-1.5">
        <p v-if="info.state !== 'active'" class="text-xs text-stone-400 dark:text-stone-500">
          上届排名
        </p>
        <TournamentStandings :standings="info.standings" :me="info.me" class="max-h-64" />
      </div>
      <p v-else class="text-center text-sm text-stone-500 dark:text-stone-400">
        瑞士轮积分赛 · 报名后到点自动配对开赛
      </p>

      <p v-if="info.registered" class="text-center text-xs text-stone-400 dark:text-stone-500">
        每轮开始后 3 分钟未准备视为弃权
      </p>

      <p v-if="!loggedIn" class="text-center text-xs text-amber-600 dark:text-amber-400">
        仅注册用户可参加
      </p>
    </div>

    <template #footer>
      <div class="-mx-3 flex flex-col">
        <DialogButton :variant="buttonVariant" @click="act">
          <IconSpinner v-if="busy" class="size-4" />
          {{ buttonText }}
        </DialogButton>
      </div>
    </template>
  </AppDialog>
</template>
