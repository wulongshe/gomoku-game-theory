<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useClipboard, useStorage, useTimestamp, useWebSocket } from '@vueuse/core'
import { nanoid } from 'nanoid'
import AppButton from '~/components/AppButton.vue'
import Board from '~/components/Board.vue'
import RulesDialog from '~/components/RulesDialog.vue'
import SharePoster from '~/components/SharePoster.vue'
import IconCross from '~/components/icons/IconCross.vue'
import IconHelp from '~/components/icons/IconHelp.vue'
import IconLogout from '~/components/icons/IconLogout.vue'
import { roomStatus, roomWsUrl } from '~/apis'
import { frameLabel, MODE_LABELS } from '~/constants/branding'
import {
  FRAME_SECONDS,
  isLegalChoice,
  type ClearedGroup,
  type GameMode,
  type GameState,
  type Point,
  type Seat,
} from '@/engine/game'
import {
  FRAME_OPTIONS,
  MODE_OPTIONS,
  type ClientMessage,
  type ServerMessage,
} from '@/shared/protocol'

const props = defineProps<{ code: string }>()

const roomUrl = location.href

type Stage = 'connecting' | 'waiting' | 'ready' | 'playing' | 'over' | 'error'

const stage = ref<Stage>('connecting')
const seat = ref<Seat>('black')
const game = ref<GameState | null>(null)
const deadline = ref<number | null>(null)
const frameStart = ref<number | null>(null)
const selected = ref<Point | null>(null)
const submitted = ref(false)
const oppSubmitted = ref(false)
const rematchAsked = ref(false)
const rematchConfig = ref(false)
const rematchFrame = ref(FRAME_SECONDS)
const rematchMode = ref<GameMode>('forbidden')
const rematchProposal = ref<{ frameSeconds: number; mode: GameMode } | null>(null)
const oppLeft = ref(false)
const rematchInvite = ref(false)
const inviteDeadline = ref<number | null>(null)
const overNotice = ref('')
const overlayDismissed = ref(false)
const errorNotice = ref('')
const lastMoves = ref<Point[]>([])
const vanishing = ref<ClearedGroup[]>([])
const confirmingExit = ref(false)
const roomClosed = ref(false)
const notFound = ref(false)
const roomFull = ref(false)
const myReady = ref(false)
const oppReady = ref(false)
const showRules = ref(false)
const frameSeconds = ref(FRAME_SECONDS)
const mode = ref<GameMode>('forbidden')
const autoSubmit = useStorage('auto-submit', false)

const posterEl = ref<InstanceType<typeof SharePoster> | null>(null)
const token = useStorage(`room-token:${props.code}`, nanoid())

function forgetToken() {
  localStorage.removeItem(`room-token:${props.code}`)
}
const now = useTimestamp({ interval: 250 })
const { copy, copied, isSupported: copySupported } = useClipboard({ legacy: true })

let replaced = false
const { send, open } = useWebSocket(roomWsUrl(props.code, token.value), {
  immediate: false,
  autoReconnect: {
    retries: (retried) => retried < 5 && !replaced && !roomClosed.value,
    delay: 1000,
    onFailed() {
      stage.value = 'error'
    },
  },
  onMessage(_ws, event) {
    handleMessage(JSON.parse(event.data as string) as ServerMessage)
  },
  onDisconnected(_ws, event) {
    if (event.reason === 'replaced by reconnect') replaced = true
    if (event.reason === 'room closed') {
      roomClosed.value = true
      forgetToken()
    }
    if (stage.value === 'over') return
    stage.value = replaced || roomClosed.value ? 'error' : 'connecting'
  },
})

onMounted(async () => {
  let status = { exists: true, full: false }
  try {
    status = await roomStatus(props.code, token.value)
  } catch {}
  if (!status.exists) {
    notFound.value = true
    stage.value = 'error'
    forgetToken()
    homeDeadline.value = Date.now() + 5000
  } else if (status.full) {
    roomFull.value = true
    stage.value = 'error'
  } else {
    open()
  }
})

function handleMessage(msg: ServerMessage) {
  switch (msg.type) {
    case 'joined':
      seat.value = msg.seat
      frameSeconds.value = msg.frameSeconds
      mode.value = msg.mode
      rematchAsked.value = false
      rematchConfig.value = false
      rematchInvite.value = false
      rematchProposal.value = null
      inviteDeadline.value = null
      stage.value = 'waiting'
      break
    case 'lobby': {
      const opp = seat.value === 'black' ? 'white' : 'black'
      myReady.value = msg.ready[seat.value]
      oppReady.value = msg.ready[opp]
      oppLeft.value = !msg.present[opp]
      stage.value = msg.present[opp] ? 'ready' : 'waiting'
      break
    }
    case 'start':
      game.value = msg.state
      deadline.value = msg.deadline === null ? null : Date.now() + (msg.deadline - msg.now)
      frameStart.value = Date.now() - msg.elapsed
      frameSeconds.value = msg.frameSeconds
      submitted.value = msg.submitted[seat.value]
      oppSubmitted.value = msg.submitted[seat.value === 'black' ? 'white' : 'black']
      selected.value = msg.yourChoice
      lastMoves.value = msg.state.lastMoves
      vanishing.value = []
      rematchAsked.value = false
      rematchInvite.value = false
      inviteDeadline.value = null
      overNotice.value = ''
      overlayDismissed.value = false
      errorNotice.value = ''
      stage.value = msg.state.phase === 'playing' ? 'playing' : 'over'
      break
    case 'frame_settled':
      lastMoves.value = msg.state.lastMoves
      vanishing.value = msg.state.cleared
      game.value = msg.state
      deadline.value = msg.deadline === null ? null : Date.now() + (msg.deadline - msg.now)
      frameStart.value = Date.now()
      selected.value = null
      submitted.value = false
      oppSubmitted.value = false
      errorNotice.value = ''
      if (msg.state.phase !== 'playing') stage.value = 'over'
      break
    case 'opponent_submitted':
      oppSubmitted.value = msg.submitted
      break
    case 'opponent_left':
      oppLeft.value = true
      break
    case 'opponent_returned':
      oppLeft.value = false
      break
    case 'rematch_requested':
      rematchProposal.value = { frameSeconds: msg.frameSeconds, mode: msg.mode }
      rematchAsked.value = false
      rematchInvite.value = true
      inviteDeadline.value = Date.now() + 30_000
      break
    case 'rematch_declined':
      rematchAsked.value = false
      overNotice.value = '对方拒绝了再来一局'
      break
    case 'error':
      errorNotice.value = msg.message
      break
  }
}

const remainingRatio = computed(() => {
  if (deadline.value === null) return 0
  return Math.min(1, Math.max(0, (deadline.value - now.value) / (frameSeconds.value * 1000)))
})

const secondsLeft = computed(() => {
  if (deadline.value === null) return null
  const left = Math.max(0, Math.ceil((deadline.value - now.value) / 1000))
  return Math.min(frameSeconds.value, left)
})

const overdue = computed(() => deadline.value !== null && now.value >= deadline.value)

const elapsedSeconds = computed(() => {
  if (frameStart.value === null || stage.value !== 'playing') return 0
  return Math.max(0, Math.floor((now.value - frameStart.value) / 1000))
})

const urgency = computed(() => {
  if (secondsLeft.value === null) return 'calm'
  if (secondsLeft.value <= 5) return 'critical'
  if (remainingRatio.value <= 1 / 3) return 'warning'
  return 'calm'
})

const oppStatus = computed(() => {
  if (oppLeft.value)
    return { text: '对方已离开', dot: 'bg-red-500', cls: 'text-red-600 dark:text-red-400' }
  if (stage.value === 'over')
    return {
      text: `对局结束 · ${winnerLabel.value}`,
      dot: 'bg-stone-400',
      cls: 'text-stone-500 dark:text-stone-400',
    }
  if (overdue.value)
    return {
      text: '结算中…',
      dot: 'animate-pulse bg-stone-400',
      cls: 'text-stone-500 dark:text-stone-400',
    }
  if (oppSubmitted.value)
    return {
      text: '对方已提交',
      dot: 'bg-emerald-500',
      cls: 'text-emerald-700 dark:text-emerald-400',
    }
  return { text: '对方思考中…', dot: 'bg-amber-400', cls: 'text-stone-500 dark:text-stone-400' }
})

const modeLabel = computed(() => MODE_LABELS[mode.value])

const seatLabel = computed(() => (seat.value === 'black' ? '你执黑' : '你执白'))
const oppSeatLabel = computed(() => (seat.value === 'black' ? '对方执白' : '对方执黑'))

const winnerSeat = computed<Seat | null>(() => {
  if (game.value?.phase === 'black_won') return 'black'
  if (game.value?.phase === 'white_won') return 'white'
  return null
})

const winnerLabel = computed(() =>
  winnerSeat.value ? (winnerSeat.value === 'black' ? '黑方获胜' : '白方获胜') : '和棋',
)

const resultChar = computed(() => {
  if (!winnerSeat.value) return '和'
  return winnerSeat.value === seat.value ? '赢' : '输'
})

const resultColors = computed(() => {
  if (!winnerSeat.value) return ['#10b981', '#047857']
  return winnerSeat.value === seat.value ? ['#fbbf24', '#d97706'] : ['#a8a29e', '#57534e']
})

function sendChoice(point: Point, final: boolean) {
  if (!game.value) return
  const msg: ClientMessage = { type: 'submit', frame: game.value.frame, point, final }
  send(JSON.stringify(msg))
}

function select(point: Point) {
  if (stage.value !== 'playing' || !game.value) return
  if (submitted.value && oppSubmitted.value) return
  if (!isLegalChoice(game.value, point)) return
  selected.value = point
  if (autoSubmit.value) {
    sendChoice(point, true)
    submitted.value = true
  } else {
    sendChoice(point, false)
    submitted.value = false
  }
}

function submitChoice() {
  if (!game.value || !selected.value || submitted.value) return
  sendChoice(selected.value, true)
  submitted.value = true
}

watch(autoSubmit, (on) => {
  if (on && stage.value === 'playing') submitChoice()
})

function sendReady() {
  if (myReady.value) return
  send(JSON.stringify({ type: 'ready' } satisfies ClientMessage))
  myReady.value = true
}

function openRematchConfig() {
  if (rematchAsked.value) return
  rematchFrame.value = frameSeconds.value
  rematchMode.value = mode.value
  rematchConfig.value = true
}

function sendRematch(frameSeconds: number, mode: GameMode) {
  send(JSON.stringify({ type: 'rematch', frameSeconds, mode } satisfies ClientMessage))
  rematchAsked.value = true
}

function confirmRematch() {
  rematchConfig.value = false
  sendRematch(rematchFrame.value, rematchMode.value)
}

const inviteSecondsLeft = computed(() =>
  inviteDeadline.value === null
    ? null
    : Math.max(0, Math.ceil((inviteDeadline.value - now.value) / 1000)),
)

watch(inviteSecondsLeft, (s) => {
  if (s === 0) declineRematch()
})

function acceptRematch() {
  rematchInvite.value = false
  inviteDeadline.value = null
  if (rematchProposal.value) {
    sendRematch(rematchProposal.value.frameSeconds, rematchProposal.value.mode)
  }
}

function declineRematch() {
  if (!rematchInvite.value) return
  rematchInvite.value = false
  inviteDeadline.value = null
  send(JSON.stringify({ type: 'rematch_decline' } satisfies ClientMessage))
}

const homeDeadline = ref<number | null>(null)

const homeSecondsLeft = computed(() =>
  homeDeadline.value === null ? null : Math.max(0, Math.ceil((homeDeadline.value - now.value) / 1000)),
)

watch(homeSecondsLeft, (s) => {
  if (s === 0) location.assign('/')
})

const errorInfo = computed(() => {
  if (notFound.value)
    return { title: '房间不存在或已关闭', desc: '链接可能已失效，房主离开后房间会自动关闭' }
  if (roomFull.value) return { title: '房间已满', desc: '两个座位都已有人，回首页自己开一局吧' }
  return { title: '无法加入房间', desc: '连接失败，请检查网络后重试' }
})

function reload() {
  location.reload()
}

function exitRoom() {
  send(JSON.stringify({ type: 'leave' } satisfies ClientMessage))
  forgetToken()
  setTimeout(() => location.assign('/'), 150)
}
</script>

<template>
  <main
    class="flex min-h-dvh flex-col items-center bg-gradient-to-b from-stone-100 to-stone-200 p-4 dark:from-stone-900 dark:to-stone-950"
  >
    <template v-if="stage === 'connecting'">
      <div class="flex flex-1 flex-col items-center justify-center gap-3">
        <div class="flex gap-1.5">
          <span class="size-2.5 animate-[breathe_1.2s_ease-in-out_infinite] rounded-full bg-stone-500 dark:bg-stone-400" />
          <span
            class="size-2.5 animate-[breathe_1.2s_ease-in-out_0.2s_infinite] rounded-full bg-stone-500 dark:bg-stone-400"
          />
          <span
            class="size-2.5 animate-[breathe_1.2s_ease-in-out_0.4s_infinite] rounded-full bg-stone-500 dark:bg-stone-400"
          />
        </div>
        <p class="text-stone-600 dark:text-stone-300">正在连接房间 {{ props.code }}…</p>
      </div>
    </template>

    <template v-else-if="stage === 'waiting'">
      <div class="flex flex-1 flex-col items-center justify-center gap-5">
        <div
          class="flex w-full max-w-md flex-col items-center gap-4 rounded-2xl bg-white/80 p-8 shadow-sm backdrop-blur dark:bg-stone-800/80"
        >
          <p class="text-sm text-stone-500 dark:text-stone-400">房间号</p>
          <p class="text-4xl font-bold tracking-[0.3em] text-stone-800 dark:text-stone-100">{{ props.code }}</p>
          <p class="flex items-center gap-2 text-sm text-stone-500 dark:text-stone-400">
            <span
              class="size-2 animate-[breathe_1.2s_ease-in-out_infinite] rounded-full bg-amber-400"
            />
            等待对方加入…
          </p>
          <SharePoster
            ref="posterEl"
            :url="roomUrl"
            :code="props.code"
            :frame-seconds="frameSeconds"
            :mode="mode"
            class="h-auto w-64 rounded-xl shadow-md"
          />
          <p class="text-sm text-stone-500 dark:text-stone-400">对方扫码或打开链接即可开始</p>
          <div class="flex w-full gap-2">
            <AppButton v-if="copySupported" class="flex-1" @click="copy(roomUrl)">
              {{ copied ? '已复制 ✓' : '复制链接' }}
            </AppButton>
            <AppButton secondary class="flex-1" @click="posterEl?.share()">分享海报</AppButton>
          </div>
          <p
            v-if="!copySupported"
            class="max-w-full rounded-lg bg-stone-100 px-3 py-2 text-xs break-all text-stone-500 select-all dark:bg-stone-700/60 dark:text-stone-400"
          >
            {{ roomUrl }}
          </p>
        </div>
      </div>
    </template>

    <template v-else-if="stage === 'ready'">
      <div class="flex flex-1 flex-col items-center justify-center gap-5">
        <div
          class="flex w-full max-w-md flex-col items-center gap-4 rounded-2xl bg-white/80 p-8 shadow-sm backdrop-blur dark:bg-stone-800/80"
        >
          <p class="text-sm text-stone-500 dark:text-stone-400">房间号</p>
          <p class="text-4xl font-bold tracking-[0.3em] text-stone-800 dark:text-stone-100">{{ props.code }}</p>
          <div class="flex items-center gap-2 text-xs text-stone-500 dark:text-stone-400">
            <span class="rounded-full bg-stone-100 px-2.5 py-1 dark:bg-stone-700/60">每回合 {{ frameLabel(frameSeconds) }}</span>
            <span class="rounded-full bg-stone-100 px-2.5 py-1 dark:bg-stone-700/60">{{ modeLabel }}模式</span>
          </div>
          <div class="flex w-full flex-col gap-2">
            <div
              v-for="player in [
                { label: seatLabel, black: seat === 'black', ready: myReady },
                { label: oppSeatLabel, black: seat !== 'black', ready: oppReady },
              ]"
              :key="player.label"
              class="flex items-center justify-between rounded-xl bg-stone-100 px-4 py-3 dark:bg-stone-700/50"
            >
              <span class="flex items-center gap-2 text-sm font-medium text-stone-700 dark:text-stone-200">
                <span
                  class="inline-block size-3.5 rounded-full"
                  :class="player.black ? 'bg-stone-900 dark:ring-1 dark:ring-stone-400' : 'border border-stone-400 bg-white'"
                />
                {{ player.label }}
              </span>
              <span
                class="text-sm font-medium"
                :class="player.ready ? 'text-emerald-600 dark:text-emerald-400' : 'text-stone-400 dark:text-stone-500'"
              >
                {{ player.ready ? '已准备 ✓' : '未准备' }}
              </span>
            </div>
          </div>
          <AppButton class="w-full" :disabled="myReady" @click="sendReady">
            {{ myReady ? '已准备，等待对方…' : '准备' }}
          </AppButton>
        </div>
        <p class="flex items-center gap-2 text-sm text-stone-500 dark:text-stone-400">
          <span class="size-2 animate-[breathe_1.2s_ease-in-out_infinite] rounded-full bg-amber-400" />
          {{ myReady ? '等待对方准备…' : '对方已加入，双方准备后开局' }}
        </p>
      </div>
    </template>

    <template v-else-if="stage === 'playing' || stage === 'over'">
      <div class="flex w-full max-w-md flex-1 flex-col justify-center gap-3">
        <div class="grid grid-cols-[1fr_auto_1fr] items-center text-sm">
          <span class="flex items-center gap-1.5 justify-self-start font-medium text-stone-700 dark:text-stone-200">
            <span
              class="inline-block size-3.5 rounded-full"
              :class="seat === 'black' ? 'bg-stone-900 dark:ring-1 dark:ring-stone-400' : 'border border-stone-400 bg-white'"
            />
            {{ seatLabel }}
          </span>
          <span class="flex items-center gap-1.5 rounded-full bg-white/70 px-3 py-0.5 text-xs text-stone-500 dark:bg-stone-800/70 dark:text-stone-400">
            房间 {{ props.code }}
            <button
              class="cursor-pointer text-red-400 transition-colors hover:text-red-600"
              aria-label="退出房间"
              @click="confirmingExit = true"
            >
              <IconLogout class="size-3.5" />
            </button>
          </span>
          <button
            class="flex cursor-pointer items-center gap-1 justify-self-end font-medium text-stone-500 transition-colors hover:text-stone-700 active:text-stone-700 dark:text-stone-400 dark:hover:text-stone-200 dark:active:text-stone-200"
            @click="showRules = true"
          >
            <template v-if="modeLabel">{{ modeLabel }}模式</template>
            <IconHelp class="size-4 translate-y-px" />
          </button>
        </div>

        <div class="grid grid-cols-[1fr_auto_1fr] items-center text-sm">
          <span class="flex items-center gap-1.5 justify-self-start" :class="oppStatus.cls">
            <span class="size-2 rounded-full" :class="oppStatus.dot" />
            {{ oppStatus.text }}
          </span>
          <span class="font-medium text-stone-700 dark:text-stone-200">第 {{ game?.frame }} 回合</span>
          <span
            class="justify-self-end text-base font-semibold tabular-nums"
            :class="{
              'text-stone-600 dark:text-stone-300': urgency === 'calm',
              'text-amber-600 dark:text-amber-400': urgency === 'warning',
              'animate-pulse text-red-600 dark:text-red-400': urgency === 'critical',
            }"
          >
            {{ frameSeconds === 0 ? `${elapsedSeconds}s/∞` : `${secondsLeft ?? 0}s/${frameSeconds}s` }}
          </span>
        </div>

        <div v-if="frameSeconds > 0" class="h-1.5 overflow-hidden rounded-full bg-stone-300/70 dark:bg-stone-700/70">
          <div
            class="h-full rounded-full transition-[width] duration-200 ease-linear"
            :class="{
              'bg-stone-500 dark:bg-stone-400': urgency === 'calm',
              'bg-amber-500': urgency === 'warning',
              'bg-red-500': urgency === 'critical',
            }"
            :style="{ width: `${remainingRatio * 100}%` }"
          />
        </div>

        <div class="relative w-full">
          <Board
            v-if="game"
            :state="game"
            :seat="seat"
            :selected="selected"
            :last-moves="lastMoves"
            :vanishing="vanishing"
            :interactive="stage === 'playing' && (!submitted || !oppSubmitted)"
            @select="select"
          />
          <div
            v-if="stage === 'over' && !overlayDismissed"
            class="absolute inset-0 flex cursor-pointer flex-col items-center justify-center"
            role="button"
            aria-label="关闭结果浮层"
            @click="overlayDismissed = true"
          >
            <svg
              viewBox="0 0 144 144"
              class="w-36 animate-[stamp_0.4s_ease-out] drop-shadow-[0_6px_16px_rgba(28,25,23,0.45)]"
              :style="{ rotate: '-8deg' }"
              aria-hidden="true"
            >
              <defs>
                <linearGradient id="result-grad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" :stop-color="resultColors[0]" />
                  <stop offset="100%" :stop-color="resultColors[1]" />
                </linearGradient>
              </defs>
              <text
                x="72"
                y="72"
                text-anchor="middle"
                dominant-baseline="central"
                font-size="128"
                font-weight="900"
                fill="url(#result-grad)"
                style="font-family: STKaiti, KaiTi, 'Noto Serif SC', serif"
              >
                {{ resultChar }}
              </text>
            </svg>
            <span class="mt-2 rounded-full bg-black/30 px-3 py-1 text-xs text-white">
              点击查看棋盘
            </span>
          </div>
        </div>

        <template v-if="stage === 'playing'">
          <AppButton
            class="w-full"
            :disabled="!selected || submitted || autoSubmit"
            @click="submitChoice"
          >
            {{
              submitted
                ? '已提交，等待对方'
                : autoSubmit
                  ? '点击棋盘落子即提交'
                  : selected
                    ? '确认提交'
                    : '点击棋盘选择落点'
            }}
          </AppButton>
          <div class="flex min-h-4 items-center justify-between text-xs text-stone-400 dark:text-stone-500">
            <label class="flex cursor-pointer items-center gap-2 select-none">
              <input v-model="autoSubmit" type="checkbox" class="peer sr-only" />
              <span
                class="relative h-4.5 w-8 rounded-full bg-stone-300 transition-colors peer-checked:bg-stone-800 after:absolute after:top-0.5 after:left-0.5 after:size-3.5 after:rounded-full after:bg-white after:shadow-sm after:transition-transform peer-checked:after:translate-x-3.5 dark:bg-stone-600 dark:peer-checked:bg-emerald-600"
              />
              落子自动提交
            </label>
            <span>
              <template v-if="errorNotice">{{ errorNotice }}</template>
              <template v-else-if="frameSeconds > 0 && selected && !submitted">
                倒计时结束将自动提交已选落点
              </template>
              <template v-else-if="submitted && !oppSubmitted">对方提交前仍可变更落点</template>
            </span>
          </div>
        </template>

        <template v-else>
          <AppButton
            v-if="!roomClosed"
            class="w-full"
            :disabled="rematchAsked"
            @click="openRematchConfig"
          >
            {{ rematchAsked ? '等待对方…' : '邀请对方再来一局' }}
          </AppButton>
          <p v-else class="text-center text-sm text-stone-500 dark:text-stone-400">对方已退出，房间已关闭</p>
          <p class="min-h-4 text-center text-xs text-stone-400 dark:text-stone-500">{{ overNotice }}</p>
        </template>
      </div>
    </template>

    <template v-else>
      <div class="flex flex-1 flex-col items-center justify-center gap-4">
        <template v-if="game">
          <p class="text-stone-600 dark:text-stone-300">连接已断开</p>
          <AppButton @click="reload">重新连接</AppButton>
        </template>
        <template v-else>
          <div
            class="flex w-full max-w-md flex-col items-center gap-4 rounded-2xl bg-white/80 p-8 text-center shadow-sm backdrop-blur dark:bg-stone-800/80"
          >
            <span class="flex size-14 items-center justify-center rounded-full bg-red-50 text-red-500 dark:bg-red-500/15 dark:text-red-400">
              <IconCross class="size-6" />
            </span>
            <div class="flex flex-col gap-1">
              <p class="text-lg font-semibold text-stone-800 dark:text-stone-100">{{ errorInfo.title }}</p>
              <p class="text-sm text-stone-500 dark:text-stone-400">{{ errorInfo.desc }}</p>
            </div>
            <p class="rounded-full bg-stone-100 px-4 py-1 text-sm tracking-[0.2em] text-stone-400 dark:bg-stone-700/60 dark:text-stone-500">
              {{ props.code }}
            </p>
            <a class="w-full" href="/">
              <AppButton class="w-full">
                返回首页<template v-if="homeSecondsLeft !== null">（{{ homeSecondsLeft }}s）</template>
              </AppButton>
            </a>
          </div>
        </template>
      </div>
    </template>

    <div
      v-if="rematchInvite"
      class="fixed inset-0 z-10 flex items-center justify-center bg-black/40 p-6"
      @click.self="declineRematch"
    >
      <div class="flex w-full max-w-xs flex-col gap-4 rounded-2xl bg-white p-6 shadow-lg dark:bg-stone-800">
        <p class="text-base font-semibold text-stone-800 dark:text-stone-100">对方想再来一局</p>
        <p v-if="rematchProposal" class="flex items-center gap-2 text-sm text-stone-600 dark:text-stone-300">
          <span class="rounded-full bg-stone-100 px-2.5 py-1 dark:bg-stone-700/60">每回合 {{ frameLabel(rematchProposal.frameSeconds) }}</span>
          <span class="rounded-full bg-stone-100 px-2.5 py-1 dark:bg-stone-700/60">{{ MODE_LABELS[rematchProposal.mode] }}模式</span>
        </p>
        <p class="text-sm text-stone-500 dark:text-stone-400">{{ inviteSecondsLeft }} 秒后自动关闭</p>
        <div class="flex gap-2">
          <button
            class="flex-1 cursor-pointer rounded-xl bg-stone-200 px-4 py-2.5 font-medium text-stone-700 active:bg-stone-300 dark:bg-stone-700 dark:text-stone-200 dark:active:bg-stone-600"
            @click="declineRematch"
          >
            拒绝
          </button>
          <button
            class="flex-1 cursor-pointer rounded-xl bg-stone-800 px-4 py-2.5 font-medium text-white active:bg-stone-600 dark:bg-stone-200 dark:text-stone-900 dark:active:bg-stone-400"
            @click="acceptRematch"
          >
            接受
          </button>
        </div>
      </div>
    </div>

    <div
      v-if="rematchConfig"
      class="fixed inset-0 z-10 flex items-center justify-center bg-black/40 p-6"
      @click.self="rematchConfig = false"
    >
      <div class="flex w-full max-w-xs flex-col gap-4 rounded-2xl bg-white p-6 shadow-lg dark:bg-stone-800">
        <p class="text-base font-semibold text-stone-800 dark:text-stone-100">再来一局</p>
        <div class="flex flex-col gap-3 text-sm">
          <div class="flex flex-col gap-2">
            <span class="text-center text-stone-500 dark:text-stone-400">每回合</span>
            <div class="flex rounded-lg bg-stone-200 p-0.5 dark:bg-stone-700">
              <button
                v-for="option in FRAME_OPTIONS"
                :key="option"
                class="inline-flex h-7 flex-1 cursor-pointer items-center justify-center rounded-md pb-px font-medium leading-none transition-colors"
                :class="rematchFrame === option ? 'bg-white text-stone-800 shadow-sm dark:bg-stone-900 dark:text-stone-100' : 'text-stone-500 dark:text-stone-400'"
                @click="rematchFrame = option"
              >
                {{ option ? `${option}s` : '不限' }}
              </button>
            </div>
          </div>
          <div class="flex flex-col gap-2">
            <span class="text-center text-stone-500 dark:text-stone-400">撞点后</span>
            <div class="flex rounded-lg bg-stone-200 p-0.5 dark:bg-stone-700">
              <button
                v-for="option in MODE_OPTIONS"
                :key="option"
                class="inline-flex h-7 flex-1 cursor-pointer items-center justify-center rounded-md pb-px font-medium leading-none transition-colors"
                :class="rematchMode === option ? 'bg-white text-stone-800 shadow-sm dark:bg-stone-900 dark:text-stone-100' : 'text-stone-500 dark:text-stone-400'"
                @click="rematchMode = option"
              >
                {{ MODE_LABELS[option] }}
              </button>
            </div>
          </div>
        </div>
        <div class="flex gap-2">
          <button
            class="flex-1 cursor-pointer rounded-xl bg-stone-200 px-4 py-2.5 font-medium text-stone-700 active:bg-stone-300 dark:bg-stone-700 dark:text-stone-200 dark:active:bg-stone-600"
            @click="rematchConfig = false"
          >
            取消
          </button>
          <button
            class="flex-1 cursor-pointer rounded-xl bg-stone-800 px-4 py-2.5 font-medium text-white active:bg-stone-600 dark:bg-stone-200 dark:text-stone-900 dark:active:bg-stone-400"
            @click="confirmRematch"
          >
            发起邀请
          </button>
        </div>
      </div>
    </div>

    <div
      v-if="confirmingExit"
      class="fixed inset-0 z-10 flex items-center justify-center bg-black/40 p-6"
      @click.self="confirmingExit = false"
    >
      <div class="flex w-full max-w-xs flex-col gap-4 rounded-2xl bg-white p-6 shadow-lg dark:bg-stone-800">
        <p class="text-base font-semibold text-stone-800 dark:text-stone-100">退出房间？</p>
        <p class="text-sm text-stone-500 dark:text-stone-400">
          {{
            stage === 'playing'
              ? '退出即认输，判对方获胜，房间将关闭。'
              : '退出后房间将关闭。'
          }}
        </p>
        <div class="flex gap-2">
          <button
            class="flex-1 cursor-pointer rounded-xl bg-stone-200 px-4 py-2.5 font-medium text-stone-700 active:bg-stone-300 dark:bg-stone-700 dark:text-stone-200 dark:active:bg-stone-600"
            @click="confirmingExit = false"
          >
            取消
          </button>
          <button
            class="flex-1 cursor-pointer rounded-xl bg-red-500 px-4 py-2.5 font-medium text-white active:bg-red-600"
            @click="exitRoom"
          >
            退出
          </button>
        </div>
      </div>
    </div>

    <RulesDialog v-if="showRules" @close="showRules = false" />
  </main>
</template>
