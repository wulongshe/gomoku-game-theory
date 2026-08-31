<script setup lang="ts">
import { ref } from 'vue'
import { useWebSocket } from '@vueuse/core'
import AppButton from '~/components/AppButton.vue'
import TournamentStandings from '~/components/TournamentStandings.vue'
import IconSpinner from '~/components/icons/IconSpinner.vue'
import IconStones from '~/components/icons/IconStones.vue'
import { tournamentWsUrl } from '~/apis'
import { useAuth } from '~/composables/useAuth'
import { useCountdown } from '~/composables/useCountdown'
import { formatCountdown } from '~/utils/format'
import { backOrReplace } from '~/utils/navigation'
import type { TournamentInfo } from '@/shared/protocol'

const { loggedIn } = useAuth()
const info = ref<TournamentInfo | null>(null)
const loading = ref(true)

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
</script>

<template>
  <main
    class="flex min-h-dvh flex-col items-center bg-gradient-to-b from-stone-100 to-stone-200 p-6 dark:from-stone-900 dark:to-stone-950"
  >
    <div class="flex w-full max-w-md flex-1 flex-col items-center justify-center gap-5">
      <div class="flex flex-col items-center gap-2">
        <IconStones class="h-7 drop-shadow" />
        <h1 class="text-xl font-bold tracking-wide text-stone-800 dark:text-stone-100">每日大赛</h1>
      </div>

      <div v-if="loading && !info" class="py-8">
        <IconSpinner class="size-6 text-stone-400" />
      </div>

      <div
        v-else-if="!loggedIn && !info"
        class="flex flex-col items-center gap-4 rounded-2xl bg-white/80 p-8 text-center shadow-sm dark:bg-stone-800/80"
      >
        <p class="text-sm text-stone-500 dark:text-stone-400">仅注册用户可参加每日大赛</p>
        <AppButton @click="backOrReplace()">返回首页</AppButton>
      </div>

      <template v-else-if="info">
        <div
          class="w-full rounded-2xl bg-white/80 p-6 text-center shadow-sm backdrop-blur dark:bg-stone-800/80"
        >
          <template v-if="!loggedIn">
            <p class="text-sm text-stone-500 dark:text-stone-400">
              {{ info.state === 'active' ? '大赛进行中' : '仅注册用户可参加每日大赛' }}
            </p>
            <p class="mt-1 text-lg font-semibold text-stone-800 dark:text-stone-100">
              {{ info.state === 'active' ? '仅注册用户可参加' : '登录后即可报名' }}
            </p>
            <p class="mt-1 text-xs text-stone-400 dark:text-stone-500">可在首页登录后报名参赛</p>
          </template>
          <template v-else-if="info.myGame">
            <p class="text-sm text-stone-500 dark:text-stone-400">第 {{ info.round }} 轮 · 已为你配对</p>
            <p class="mt-1 text-lg font-semibold text-stone-800 dark:text-stone-100">准备好了就进入对局</p>
            <a :href="`/room/${info.myGame.code}`" class="mt-3 inline-block">
              <AppButton>进入对局</AppButton>
            </a>
          </template>
          <template v-else-if="info.participating">
            <p class="text-sm text-stone-500 dark:text-stone-400">
              第 {{ info.round }} / {{ info.totalRounds }} 轮 · 本轮剩余
            </p>
            <p class="mt-1 text-2xl font-bold text-stone-800 tabular-nums dark:text-stone-100">
              {{ formatCountdown(roundLeft ?? 0) }}
            </p>
            <p class="mt-1 text-xs text-stone-400 dark:text-stone-500">
              等待其他对局结束 · {{ info.playerCount }} 人参赛
            </p>
          </template>
          <template v-else-if="info.state === 'active'">
            <p class="text-sm text-stone-500 dark:text-stone-400">大赛进行中</p>
            <p class="mt-1 text-lg font-semibold text-stone-800 dark:text-stone-100">你未报名本场</p>
            <p class="mt-1 text-xs text-stone-400 dark:text-stone-500">可在首页每日大赛报名下一场</p>
          </template>
          <template v-else>
            <p class="text-sm text-stone-500 dark:text-stone-400">
              {{ info.registered ? '已报名 · 距开赛' : '距开赛' }}
            </p>
            <p class="mt-1 text-2xl font-bold text-stone-800 tabular-nums dark:text-stone-100">
              {{ formatCountdown(startLeft ?? 0) }}
            </p>
            <p class="mt-1 text-xs text-stone-400 dark:text-stone-500">
              已报名 {{ info.playerCount }} 人{{ info.registered ? ' · 到点自动进入对局' : '' }}
            </p>
          </template>
        </div>

        <div v-if="info.standings.length" class="flex min-h-0 w-full flex-col gap-1.5">
          <p v-if="info.state !== 'active'" class="px-1 text-xs text-stone-400 dark:text-stone-500">
            昨日排名
          </p>
          <TournamentStandings
            :standings="info.standings"
            :me="info.me"
            row-class="bg-white dark:bg-stone-800"
            class="max-h-96"
          />
        </div>

        <button
          type="button"
          class="cursor-pointer text-xs text-stone-400 transition-colors hover:text-stone-600 dark:text-stone-500 dark:hover:text-stone-300"
          @click="backOrReplace()"
        >
          返回首页
        </button>
      </template>
    </div>
  </main>
</template>
