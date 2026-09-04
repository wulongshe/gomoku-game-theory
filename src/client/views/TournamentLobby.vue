<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useWebSocket } from '@vueuse/core'
import AppButton from '~/components/AppButton.vue'
import SegmentedControl from '~/components/SegmentedControl.vue'
import TournamentStandings from '~/components/TournamentStandings.vue'
import IconSpinner from '~/components/icons/IconSpinner.vue'
import IconStones from '~/components/icons/IconStones.vue'
import { cancelTournamentSeek, seekTournamentMatch, tournamentWsUrl } from '~/apis'
import { useAuth } from '~/composables/useAuth'
import { useCountdown } from '~/composables/useCountdown'
import { formatCountdown } from '~/utils/format'
import { backOrReplace } from '~/utils/navigation'
import type { Match, TournamentInfo } from '@/shared/protocol'

const { loggedIn } = useAuth()
const info = ref<TournamentInfo | null>(null)
const loading = ref(true)
const busy = ref(false)

const startDeadline = ref<number | null>(null)
const startLeft = useCountdown(startDeadline)
const closeDeadline = ref<number | null>(null)
const closeLeft = useCountdown(closeDeadline)
const cooldownDeadline = ref<number | null>(null)
const cooldownLeft = useCountdown(cooldownDeadline)

function apply(data: TournamentInfo) {
  info.value = data
  startDeadline.value = Date.now() + (data.startsAt - data.now)
  closeDeadline.value =
    data.matchCloseAt === null ? null : Date.now() + (data.matchCloseAt - data.now)
  cooldownDeadline.value =
    data.my?.cooldownUntil == null ? null : Date.now() + (data.my.cooldownUntil - data.now)
  loading.value = false
}

// 冷却读秒走完就地视为空闲（服务端只在事件时推送，不为冷却到点广播）。
const myStatus = computed(() => {
  const my = info.value?.my
  if (!my) return null
  if (my.status === 'cooldown' && (cooldownLeft.value ?? 0) <= 0) return 'idle'
  return my.status
})
const matchClosed = computed(
  () => info.value?.matchCloseAt !== null && (closeLeft.value ?? 0) <= 0,
)

// 配上对手（或刷新回来还有未打完的对局）即自动进房。
let navigated = false
watch(
  () => info.value?.myGame?.code,
  (code) => {
    if (code && !navigated) {
      navigated = true
      location.assign(`/room/${code}`)
    }
  },
)

async function seek() {
  if (busy.value) return
  busy.value = true
  try {
    apply(await (myStatus.value === 'matching' ? cancelTournamentSeek() : seekTournamentMatch()))
  } catch {
    // ignore
  } finally {
    busy.value = false
  }
}

// 空闲/匹配中/冷却中都可观战对局中的桌（房号仅对可观战者下发）。
const VIEWS = ['standings', 'matches'] as const
const VIEW_LABELS: Record<(typeof VIEWS)[number], string> = {
  standings: '积分',
  matches: '观战',
}
const view = ref<(typeof VIEWS)[number]>('standings')
const currentMatches = computed<Match[]>(() =>
  info.value?.state === 'active'
    ? info.value.games.filter((m) => m.status === 'playing' && m.code)
    : [],
)

watch(currentMatches, (matches) => {
  if (!matches.length) view.value = 'standings'
})

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
    class="flex h-dvh flex-col items-center bg-gradient-to-b from-stone-100 to-stone-200 p-6 dark:from-stone-900 dark:to-stone-950"
  >
    <div class="flex min-h-0 w-full max-w-md flex-1 flex-col items-center gap-5 pt-4">
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
          <template v-else-if="info.participating">
            <p class="text-sm text-stone-500 dark:text-stone-400">
              {{ matchClosed ? '匹配已截止 · 等待收官' : '距匹配截止' }}
            </p>
            <p
              v-if="!matchClosed"
              class="mt-1 text-2xl font-bold text-stone-800 tabular-nums dark:text-stone-100"
            >
              {{ formatCountdown(closeLeft ?? 0) }}
            </p>
            <template v-if="myStatus === 'matching'">
              <AppButton
                secondary
                class="mt-3 inline-flex items-center justify-center gap-2"
                :disabled="busy"
                @click="seek"
              >
                <IconSpinner class="size-4" />匹配中，点击取消
              </AppButton>
            </template>
            <template v-else-if="myStatus === 'cooldown'">
              <p class="mt-3 text-sm font-semibold text-stone-700 dark:text-stone-200">
                冷却中 {{ cooldownLeft ?? 0 }}s
              </p>
              <p class="mt-1 text-xs text-stone-400 dark:text-stone-500">歇口气，可先观战其他对局</p>
            </template>
            <template v-else-if="myStatus === 'readying' || myStatus === 'playing'">
              <p class="mt-3 flex items-center justify-center gap-2 text-sm font-semibold text-stone-700 dark:text-stone-200">
                <IconSpinner class="size-4" />已匹配到对手，正在进入对局…
              </p>
            </template>
            <template v-else-if="!matchClosed">
              <AppButton
                class="mt-3 inline-flex items-center justify-center gap-2"
                :disabled="busy"
                @click="seek"
              >
                <IconSpinner v-if="busy" class="size-4" />匹配对手
              </AppButton>
              <p class="mt-2 text-xs text-stone-400 dark:text-stone-500">
                {{ info.playerCount }} 人参赛
              </p>
            </template>
            <template v-else>
              <p class="mt-1 text-xs text-stone-400 dark:text-stone-500">
                进行中的对局打完即出终榜
              </p>
            </template>
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
              已报名 {{ info.playerCount }} 人{{ info.registered ? ' · 开赛后手动匹配对手' : '' }}
            </p>
          </template>
          <p class="mt-1 text-xs text-stone-400 dark:text-stone-500">
            竞技场 30 分钟 · 随到随战
          </p>
        </div>

        <div
          v-if="info.standings.length || currentMatches.length"
          class="flex min-h-0 w-full flex-1 flex-col gap-1.5"
        >
          <p v-if="info.state !== 'active'" class="px-1 text-xs text-stone-400 dark:text-stone-500">
            上届排名
          </p>
          <SegmentedControl
            v-else
            v-model="view"
            :options="VIEWS"
            :label="(v) => VIEW_LABELS[v]"
            :option-disabled="(v) => v === 'matches' && !currentMatches.length"
            class="text-sm"
          />
          <TournamentStandings
            v-if="view === 'standings' || !currentMatches.length"
            :standings="info.standings"
            :me="info.me"
            row-class="bg-white dark:bg-stone-800"
            class="min-h-0 flex-1"
          />
          <div v-else class="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
            <a
              v-for="(m, i) in currentMatches"
              :key="i"
              :href="`/room/${m.code}?spectate=1`"
              class="flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm transition-colors hover:bg-stone-50 dark:bg-stone-800 dark:hover:bg-stone-700"
            >
              <span class="min-w-0 flex-1 truncate text-left text-stone-700 dark:text-stone-200">{{ m.a }}</span>
              <span
                class="shrink-0 bg-gradient-to-br from-amber-500 to-red-600 bg-clip-text font-black italic tracking-tight text-transparent"
              >VS</span>
              <span class="min-w-0 flex-1 truncate text-right text-stone-700 dark:text-stone-200">{{ m.b }}</span>
            </a>
          </div>
        </div>

        <button
          type="button"
          class="mt-auto shrink-0 cursor-pointer text-xs text-stone-400 transition-colors hover:text-stone-600 dark:text-stone-500 dark:hover:text-stone-300"
          @click="backOrReplace()"
        >
          返回首页
        </button>
      </template>
    </div>
  </main>
</template>
