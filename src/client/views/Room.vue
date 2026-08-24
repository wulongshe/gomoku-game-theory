<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useClipboard, useStorage, useTimestamp, useWebSocket } from '@vueuse/core'
import { nanoid } from 'nanoid'
import AppButton from '~/components/AppButton.vue'
import Board from '~/components/Board.vue'
import SharePoster from '~/components/SharePoster.vue'
import IconCross from '~/components/icons/IconCross.vue'
import IconLogout from '~/components/icons/IconLogout.vue'
import { roomStatus, roomWsUrl } from '~/apis'
import {
  BOARD_SIZE,
  FRAME_SECONDS,
  isLegalChoice,
  type GameState,
  type Point,
  type Seat,
} from '@/engine/game'
import type { ClientMessage, ServerMessage } from '@/shared/protocol'

const props = defineProps<{ code: string }>()

const roomUrl = location.href

type Stage = 'connecting' | 'waiting' | 'ready' | 'playing' | 'over' | 'error'

const stage = ref<Stage>('connecting')
const seat = ref<Seat>('black')
const game = ref<GameState | null>(null)
const deadline = ref<number | null>(null)
const selected = ref<Point | null>(null)
const submitted = ref(false)
const oppSubmitted = ref(false)
const rematchAsked = ref(false)
const oppLeft = ref(false)
const rematchInvite = ref(false)
const inviteDeadline = ref<number | null>(null)
const overNotice = ref('')
const overlayDismissed = ref(false)
const errorNotice = ref('')
const lastMoves = ref<Point[]>([])
const confirmingExit = ref(false)
const roomClosed = ref(false)
const notFound = ref(false)
const roomFull = ref(false)
const myReady = ref(false)
const oppReady = ref(false)
const frameSeconds = ref(FRAME_SECONDS)
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
  } else if (status.full) {
    roomFull.value = true
    stage.value = 'error'
  } else {
    open()
  }
})

function diffNewStones(next: GameState): Point[] {
  const prev = game.value?.board
  if (!prev) return []
  return next.board.flatMap((cell, i) =>
    (cell === 'black' || cell === 'white') && prev[i] === 'empty'
      ? [{ x: i % BOARD_SIZE, y: Math.floor(i / BOARD_SIZE) }]
      : [],
  )
}

function handleMessage(msg: ServerMessage) {
  switch (msg.type) {
    case 'joined':
      seat.value = msg.seat
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
      deadline.value = msg.deadline
      frameSeconds.value = msg.frameSeconds
      submitted.value = msg.submitted[seat.value]
      oppSubmitted.value = msg.submitted[seat.value === 'black' ? 'white' : 'black']
      selected.value = msg.yourChoice
      lastMoves.value = []
      rematchAsked.value = false
      rematchInvite.value = false
      inviteDeadline.value = null
      overNotice.value = ''
      overlayDismissed.value = false
      errorNotice.value = ''
      stage.value = msg.state.phase === 'playing' ? 'playing' : 'over'
      break
    case 'frame_settled':
      lastMoves.value = diffNewStones(msg.state)
      game.value = msg.state
      deadline.value = msg.deadline
      selected.value = null
      submitted.value = false
      oppSubmitted.value = false
      errorNotice.value = ''
      if (msg.state.phase !== 'playing') stage.value = 'over'
      break
    case 'opponent_submitted':
      oppSubmitted.value = true
      break
    case 'opponent_left':
      oppLeft.value = true
      break
    case 'opponent_returned':
      oppLeft.value = false
      break
    case 'rematch_requested':
      if (!rematchAsked.value) {
        rematchInvite.value = true
        inviteDeadline.value = Date.now() + 30_000
      }
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

const secondsLeft = computed(() =>
  deadline.value === null ? null : Math.max(0, Math.ceil((deadline.value - now.value) / 1000)),
)

const urgency = computed(() => {
  if (secondsLeft.value === null) return 'calm'
  if (secondsLeft.value <= 5) return 'critical'
  if (remainingRatio.value <= 1 / 3) return 'warning'
  return 'calm'
})

const oppStatus = computed(() => {
  if (oppLeft.value) return { text: '对方已离开', dot: 'bg-red-500', cls: 'text-red-600' }
  if (stage.value === 'over')
    return { text: `对局结束 · ${winnerLabel.value}`, dot: 'bg-stone-400', cls: 'text-stone-500' }
  if (oppSubmitted.value) return { text: '对方已提交', dot: 'bg-emerald-500', cls: 'text-emerald-700' }
  return { text: '对方思考中…', dot: 'bg-amber-400', cls: 'text-stone-500' }
})

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

const resultCharCls = computed(() => {
  if (!winnerSeat.value) return 'from-emerald-500 to-emerald-700'
  return winnerSeat.value === seat.value ? 'from-amber-400 to-amber-600' : 'from-stone-400 to-stone-600'
})

function sendChoice(point: Point, final: boolean) {
  if (!game.value) return
  const msg: ClientMessage = { type: 'submit', frame: game.value.frame, point, final }
  send(JSON.stringify(msg))
}

function select(point: Point) {
  if (stage.value !== 'playing' || submitted.value || !game.value) return
  if (!isLegalChoice(game.value, point)) return
  selected.value = point
  if (autoSubmit.value) {
    sendChoice(point, true)
    submitted.value = true
  } else {
    sendChoice(point, false)
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

function requestRematch() {
  if (rematchAsked.value) return
  send(JSON.stringify({ type: 'rematch' } satisfies ClientMessage))
  rematchAsked.value = true
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
  requestRematch()
}

function declineRematch() {
  if (!rematchInvite.value) return
  rematchInvite.value = false
  inviteDeadline.value = null
  send(JSON.stringify({ type: 'rematch_decline' } satisfies ClientMessage))
}

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
    class="flex min-h-dvh flex-col items-center bg-gradient-to-b from-stone-100 to-stone-200 p-4"
  >
    <template v-if="stage === 'connecting'">
      <div class="flex flex-1 flex-col items-center justify-center gap-3">
        <div class="flex gap-1.5">
          <span class="size-2.5 animate-[breathe_1.2s_ease-in-out_infinite] rounded-full bg-stone-500" />
          <span
            class="size-2.5 animate-[breathe_1.2s_ease-in-out_0.2s_infinite] rounded-full bg-stone-500"
          />
          <span
            class="size-2.5 animate-[breathe_1.2s_ease-in-out_0.4s_infinite] rounded-full bg-stone-500"
          />
        </div>
        <p class="text-stone-600">正在连接房间 {{ props.code }}…</p>
      </div>
    </template>

    <template v-else-if="stage === 'waiting'">
      <div class="flex flex-1 flex-col items-center justify-center gap-5">
        <div
          class="flex w-full max-w-md flex-col items-center gap-4 rounded-2xl bg-white/80 p-8 shadow-sm backdrop-blur"
        >
          <p class="text-sm text-stone-500">房间号</p>
          <p class="text-4xl font-bold tracking-[0.3em] text-stone-800">{{ props.code }}</p>
          <p class="flex items-center gap-2 text-sm text-stone-500">
            <span
              class="size-2 animate-[breathe_1.2s_ease-in-out_infinite] rounded-full bg-amber-400"
            />
            等待对方加入…
          </p>
          <SharePoster
            ref="posterEl"
            :url="roomUrl"
            :code="props.code"
            class="h-auto w-64 rounded-xl shadow-md"
          />
          <p class="text-sm text-stone-500">对方扫码或打开链接即可开始</p>
          <div class="flex w-full gap-2">
            <AppButton v-if="copySupported" class="flex-1" @click="copy(roomUrl)">
              {{ copied ? '已复制 ✓' : '复制链接' }}
            </AppButton>
            <AppButton secondary class="flex-1" @click="posterEl?.share()">分享海报</AppButton>
          </div>
          <p
            v-if="!copySupported"
            class="max-w-full rounded-lg bg-stone-100 px-3 py-2 text-xs break-all text-stone-500 select-all"
          >
            {{ roomUrl }}
          </p>
        </div>
      </div>
    </template>

    <template v-else-if="stage === 'ready'">
      <div class="flex flex-1 flex-col items-center justify-center gap-5">
        <div
          class="flex w-full max-w-md flex-col items-center gap-4 rounded-2xl bg-white/80 p-8 shadow-sm backdrop-blur"
        >
          <p class="text-sm text-stone-500">房间号</p>
          <p class="text-4xl font-bold tracking-[0.3em] text-stone-800">{{ props.code }}</p>
          <div class="flex w-full flex-col gap-2">
            <div
              v-for="player in [
                { label: seatLabel, black: seat === 'black', ready: myReady },
                { label: oppSeatLabel, black: seat !== 'black', ready: oppReady },
              ]"
              :key="player.label"
              class="flex items-center justify-between rounded-xl bg-stone-100 px-4 py-3"
            >
              <span class="flex items-center gap-2 text-sm font-medium text-stone-700">
                <span
                  class="inline-block size-3.5 rounded-full"
                  :class="player.black ? 'bg-stone-900' : 'border border-stone-400 bg-white'"
                />
                {{ player.label }}
              </span>
              <span
                class="text-sm font-medium"
                :class="player.ready ? 'text-emerald-600' : 'text-stone-400'"
              >
                {{ player.ready ? '已准备 ✓' : '未准备' }}
              </span>
            </div>
          </div>
          <AppButton class="w-full" :disabled="myReady" @click="sendReady">
            {{ myReady ? '已准备，等待对方…' : '准备' }}
          </AppButton>
        </div>
        <p class="flex items-center gap-2 text-sm text-stone-500">
          <span class="size-2 animate-[breathe_1.2s_ease-in-out_infinite] rounded-full bg-amber-400" />
          {{ myReady ? '等待对方准备…' : '对方已加入，双方准备后开局' }}
        </p>
      </div>
    </template>

    <template v-else-if="stage === 'playing' || stage === 'over'">
      <div class="flex w-full max-w-md flex-1 flex-col justify-center gap-3">
        <div class="flex items-center justify-between text-sm">
          <span class="flex items-center gap-1.5 font-medium text-stone-700">
            <span
              class="inline-block size-3.5 rounded-full"
              :class="seat === 'black' ? 'bg-stone-900' : 'border border-stone-400 bg-white'"
            />
            {{ seatLabel }}
          </span>
          <span class="flex items-center gap-1.5 rounded-full bg-white/70 px-3 py-0.5 text-xs text-stone-500">
            房间 {{ props.code }}
            <button
              class="cursor-pointer text-red-400 transition-colors hover:text-red-600"
              aria-label="退出房间"
              @click="confirmingExit = true"
            >
              <IconLogout class="size-3.5" />
            </button>
          </span>
          <span class="font-medium text-stone-700">第 {{ game?.frame }} 回合</span>
        </div>

        <div class="flex items-center justify-between text-sm">
          <span class="flex items-center gap-1.5" :class="oppStatus.cls">
            <span class="size-2 rounded-full" :class="oppStatus.dot" />
            {{ oppStatus.text }}
          </span>
          <span
            class="text-base font-semibold tabular-nums"
            :class="{
              'text-stone-600': urgency === 'calm',
              'text-amber-600': urgency === 'warning',
              'animate-pulse text-red-600': urgency === 'critical',
            }"
          >
            {{ secondsLeft ?? 0 }}s
          </span>
        </div>

        <div class="h-1.5 overflow-hidden rounded-full bg-stone-300/70">
          <div
            class="h-full rounded-full transition-[width] duration-200 ease-linear"
            :class="{
              'bg-stone-500': urgency === 'calm',
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
            :interactive="stage === 'playing' && !submitted"
            @select="select"
          />
          <div
            v-if="stage === 'over' && !overlayDismissed"
            class="absolute inset-0 flex cursor-pointer flex-col items-center justify-center"
            role="button"
            aria-label="关闭结果浮层"
            @click="overlayDismissed = true"
          >
            <span
              class="animate-[stamp_0.4s_ease-out] bg-gradient-to-b bg-clip-text text-9xl font-black text-transparent drop-shadow-[0_6px_16px_rgba(28,25,23,0.45)] [font-family:STKaiti,KaiTi,'Noto_Serif_SC',serif]"
              :class="resultCharCls"
              :style="{ rotate: '-8deg' }"
            >
              {{ resultChar }}
            </span>
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
          <div class="flex min-h-4 items-center justify-between text-xs text-stone-400">
            <label class="flex cursor-pointer items-center gap-2 select-none">
              <input v-model="autoSubmit" type="checkbox" class="peer sr-only" />
              <span
                class="relative h-4.5 w-8 rounded-full bg-stone-300 transition-colors peer-checked:bg-stone-800 after:absolute after:top-0.5 after:left-0.5 after:size-3.5 after:rounded-full after:bg-white after:shadow-sm after:transition-transform peer-checked:after:translate-x-3.5"
              />
              落子自动提交
            </label>
            <span>
              <template v-if="errorNotice">{{ errorNotice }}</template>
              <template v-else-if="selected && !submitted">倒计时结束将自动提交已选落点</template>
            </span>
          </div>
        </template>

        <template v-else>
          <AppButton
            v-if="!roomClosed"
            class="w-full"
            :disabled="rematchAsked"
            @click="requestRematch"
          >
            {{ rematchAsked ? '等待对方…' : '再来一局' }}
          </AppButton>
          <p v-else class="text-center text-sm text-stone-500">对方已退出，房间已关闭</p>
          <p class="min-h-4 text-center text-xs text-stone-400">{{ overNotice }}</p>
        </template>
      </div>
    </template>

    <template v-else>
      <div class="flex flex-1 flex-col items-center justify-center gap-4">
        <template v-if="game">
          <p class="text-stone-600">连接已断开</p>
          <AppButton @click="reload">重新连接</AppButton>
        </template>
        <template v-else>
          <div
            class="flex w-full max-w-md flex-col items-center gap-4 rounded-2xl bg-white/80 p-8 text-center shadow-sm backdrop-blur"
          >
            <span class="flex size-14 items-center justify-center rounded-full bg-red-50 text-red-500">
              <IconCross class="size-6" />
            </span>
            <div class="flex flex-col gap-1">
              <p class="text-lg font-semibold text-stone-800">{{ errorInfo.title }}</p>
              <p class="text-sm text-stone-500">{{ errorInfo.desc }}</p>
            </div>
            <p class="rounded-full bg-stone-100 px-4 py-1 text-sm tracking-[0.2em] text-stone-400">
              {{ props.code }}
            </p>
            <a class="w-full" href="/">
              <AppButton class="w-full">返回首页</AppButton>
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
      <div class="flex w-full max-w-xs flex-col gap-4 rounded-2xl bg-white p-6 shadow-lg">
        <p class="text-base font-semibold text-stone-800">对方想再来一局</p>
        <p class="text-sm text-stone-500">{{ inviteSecondsLeft }} 秒后自动关闭</p>
        <div class="flex gap-2">
          <button
            class="flex-1 cursor-pointer rounded-xl bg-stone-200 px-4 py-2.5 font-medium text-stone-700 active:bg-stone-300"
            @click="declineRematch"
          >
            拒绝
          </button>
          <button
            class="flex-1 cursor-pointer rounded-xl bg-stone-800 px-4 py-2.5 font-medium text-white active:bg-stone-600"
            @click="acceptRematch"
          >
            接受
          </button>
        </div>
      </div>
    </div>

    <div
      v-if="confirmingExit"
      class="fixed inset-0 z-10 flex items-center justify-center bg-black/40 p-6"
      @click.self="confirmingExit = false"
    >
      <div class="flex w-full max-w-xs flex-col gap-4 rounded-2xl bg-white p-6 shadow-lg">
        <p class="text-base font-semibold text-stone-800">退出房间？</p>
        <p class="text-sm text-stone-500">
          {{
            stage === 'playing'
              ? '退出即认输，判对方获胜，房间将关闭。'
              : '退出后房间将关闭。'
          }}
        </p>
        <div class="flex gap-2">
          <button
            class="flex-1 cursor-pointer rounded-xl bg-stone-200 px-4 py-2.5 font-medium text-stone-700 active:bg-stone-300"
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
  </main>
</template>
