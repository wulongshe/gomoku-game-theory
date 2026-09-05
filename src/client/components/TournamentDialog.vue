<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useWebSocket } from '@vueuse/core'
import AppDialog from '~/components/AppDialog.vue'
import DialogButton from '~/components/DialogButton.vue'
import SegmentedControl from '~/components/SegmentedControl.vue'
import TournamentMatches from '~/components/TournamentMatches.vue'
import TournamentStandings from '~/components/TournamentStandings.vue'
import IconSpinner from '~/components/icons/IconSpinner.vue'
import { registerTournament, tournamentWsUrl, withdrawTournament } from '~/apis'
import { useAuth } from '~/composables/useAuth'
import { useCountdown } from '~/composables/useCountdown'
import { formatCountdown, formatDailyTime } from '~/utils/format'
import type { Match, TournamentInfo } from '@/shared/protocol'

const emit = defineEmits<{ close: []; login: [] }>()

const { loggedIn } = useAuth()
const info = ref<TournamentInfo | null>(null)
const busy = ref(false)
const loading = ref(true)

// 服务端时钟偏移校正后再倒计时。
const startDeadline = ref<number | null>(null)
const startLeft = useCountdown(startDeadline)
const closeDeadline = ref<number | null>(null)
const closeLeft = useCountdown(closeDeadline)

function apply(data: TournamentInfo) {
  info.value = data
  startDeadline.value = Date.now() + (data.startsAt - data.now)
  closeDeadline.value =
    data.matchCloseAt === null ? null : Date.now() + (data.matchCloseAt - data.now)
  loading.value = false
}

// 与大厅一致的观战入口：进行中可切到对局中的桌。
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

// 进行中给列表按屏高定死高度：积分/观战两个 tab 内容行数不同，跟随内容会让弹窗抖动。
const listHeight = computed(() =>
  info.value?.state === 'active' ? 'h-[38dvh]' : 'max-h-64',
)

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
            {{ (closeLeft ?? 0) > 0 ? '进行中 · 距匹配截止' : '匹配已截止 · 等待收官' }}
          </p>
          <p
            v-if="(closeLeft ?? 0) > 0"
            class="mt-1 text-2xl font-bold text-stone-800 tabular-nums dark:text-stone-100"
          >
            {{ formatCountdown(closeLeft ?? 0) }}
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
            {{ info.state === 'active' ? '报名参加明天的大赛' : `每日 ${formatDailyTime(info.startsAt)} · 已报名 ${info.playerCount} 人` }}
          </p>
        </template>
        <p class="mt-1 text-xs text-stone-400 dark:text-stone-500">
          竞技场 {{ info.arenaMinutes }} 分钟 · 随到随战
        </p>
      </div>

      <div
        v-if="info.standings.length || currentMatches.length"
        class="flex flex-col gap-1.5"
      >
        <p v-if="info.state !== 'active'" class="text-xs text-stone-400 dark:text-stone-500">
          上届排名
        </p>
        <SegmentedControl
          v-else
          v-model="view"
          :options="VIEWS"
          :label="(v) => VIEW_LABELS[v]"
          class="text-sm"
        />
        <TournamentStandings
          v-if="view === 'standings'"
          :standings="info.standings"
          :me="info.me"
          :class="listHeight"
        />
        <TournamentMatches v-else :matches="currentMatches" :class="listHeight" />
      </div>
      <p v-else class="text-center text-sm text-stone-500 dark:text-stone-400">
        竞技场积分赛 · 多打多得
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
