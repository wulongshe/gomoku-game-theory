<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useEventListener, useStorage, useWebSocket } from '@vueuse/core'
import { nanoid } from 'nanoid'
import AppButton from '~/components/AppButton.vue'
import AppDialog from '~/components/AppDialog.vue'
import AppSwitch from '~/components/AppSwitch.vue'
import Board from '~/components/Board.vue'
import DialogButton from '~/components/DialogButton.vue'
import FrameBar from '~/components/FrameBar.vue'
import FrameTimer from '~/components/FrameTimer.vue'
import GameConfigDialog from '~/components/GameConfigDialog.vue'
import PlayersDialog from '~/components/PlayersDialog.vue'
import RematchInviteDialog from '~/components/RematchInviteDialog.vue'
import ResultOverlay from '~/components/ResultOverlay.vue'
import RoomReady from '~/components/RoomReady.vue'
import RoomWaiting from '~/components/RoomWaiting.vue'
import RulesDialog from '~/components/RulesDialog.vue'
import IconCross from '~/components/icons/IconCross.vue'
import IconHelp from '~/components/icons/IconHelp.vue'
import IconHome from '~/components/icons/IconHome.vue'
import IconLogout from '~/components/icons/IconLogout.vue'
import IconSettings from '~/components/icons/IconSettings.vue'
import IconUsers from '~/components/icons/IconUsers.vue'
import IconStone from '~/components/icons/IconStone.vue'
import IconStones from '~/components/icons/IconStones.vue'
import { roomStatus, roomWsUrl, spectateWsUrl, tournamentWsUrl } from '~/apis'
import { useAuth } from '~/composables/useAuth'
import { useCountdown } from '~/composables/useCountdown'
import { useFrameClock } from '~/composables/useFrameClock'
import { useGameReview } from '~/composables/useGameReview'
import { useGameResult } from '~/composables/useGameResult'
import { MODE_LABELS } from '@gomoku/branding'
import { ROOM_KEY_PREFIX, ROOM_MOVES_KEY } from '~/constants/storage'
import { backOrReplace } from '~/utils/navigation'
import {
  createGame,
  FRAME_SECONDS,
  isLegalChoice,
  settleFrame,
  type ClearedGroup,
  type GameMode,
  type GameState,
  type Point,
  type Seat,
} from '@gomoku/engine/game'
import {
  tournamentFrameSeconds,
  type ClientMessage,
  type FrameMoves,
  type ServerMessage,
  type TournamentInfo,
} from '@/shared/protocol'

const props = defineProps<{ code: string }>()

const roomUrl = location.href
// 观战模式（大赛限定）：只读连接；帧内选点不可见，帧结算后才看到双方落子。
const spectating = new URLSearchParams(location.search).get('spectate') === '1'

type Stage = 'connecting' | 'waiting' | 'ready' | 'playing' | 'over' | 'error'

const stage = ref<Stage>('connecting')
const seat = ref<Seat>('black')
const game = ref<GameState | null>(null)
const {
  state: reviewState,
  atFirst: reviewAtFirst,
  atLatest: reviewAtLatest,
  available: reviewAvailable,
  record: recordFrame,
  reset: resetReview,
  step: stepReview,
} = useGameReview()
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
const rematchDeadline = ref<number | null>(null)
const oppLeft = ref(false)
const rematchInvite = ref(false)
const inviteDeadline = ref<number | null>(null)
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
const showSettings = ref(false)
const showPlayers = ref(false)
const seatAccounts = ref<Record<Seat, string | null>>({ black: null, white: null })
const frameSeconds = ref(FRAME_SECONDS)
const mode = ref<GameMode>('forbidden')
const tournament = ref(false)
const autoSubmit = useStorage('auto-submit', false)
const showConcede = ref(false)
const drawInvite = ref(false)
const drawInviteDeadline = ref<number | null>(null)
const toast = ref('')

let toastTimer: ReturnType<typeof setTimeout> | undefined
function showToast(message: string) {
  toast.value = message
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toast.value = ''), 3000)
}

const key = useStorage(`${ROOM_KEY_PREFIX}${props.code}`, nanoid())
const { refresh: refreshAuth } = useAuth()
refreshAuth()

function forgetKey() {
  localStorage.removeItem(`${ROOM_KEY_PREFIX}${props.code}`)
}

// 全帧落点只存本地（不写 DO）：逐帧追加，刷新后重放复原复盘历史；退出/房间关闭即删。
let movesLog: FrameMoves[] = []
function logMove(entry: FrameMoves) {
  movesLog.push(entry)
  localStorage.setItem(ROOM_MOVES_KEY, JSON.stringify({ code: props.code, moves: movesLog }))
}
function clearMoves() {
  movesLog = []
  localStorage.removeItem(ROOM_MOVES_KEY)
}
// 存档与快照对不上（换房/再来一局/中途缺帧）就丢弃存档，从当前帧起重新记。
function restoreMoves(state: GameState) {
  movesLog = []
  try {
    const saved = JSON.parse(localStorage.getItem(ROOM_MOVES_KEY) ?? 'null') as {
      code: string
      moves: FrameMoves[]
    } | null
    if (!saved || saved.code !== props.code || !saved.moves.length) return
    let replayed = createGame(state.mode)
    for (const [black, white, first] of saved.moves) {
      replayed = settleFrame(replayed, { black, white, first })
      recordFrame(replayed)
    }
    if (replayed.frame === state.frame && replayed.phase === state.phase) {
      movesLog = saved.moves
      return
    }
  } catch {}
  resetReview()
  localStorage.removeItem(ROOM_MOVES_KEY)
}
let replaced = false
let everOpened = false
const {
  send,
  open,
  status: wsStatus,
} = useWebSocket(spectating ? spectateWsUrl(props.code) : roomWsUrl(props.code, key.value), {
  immediate: false,
  heartbeat: {
    message: 'ping',
    responseMessage: 'pong',
    interval: 20_000,
    pongTimeout: 10_000,
  },
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
      forgetKey()
      clearMoves()
    }
    if (stage.value === 'over') return
    stage.value = replaced || roomClosed.value ? 'error' : 'connecting'
  },
})

function reopenIfDead() {
  if (!everOpened || replaced || roomClosed.value || notFound.value || roomFull.value) return
  if (wsStatus.value !== 'CLOSED') return
  if (stage.value === 'error') stage.value = 'connecting'
  open()
}

useEventListener(document, 'visibilitychange', () => {
  if (document.visibilityState === 'visible') reopenIfDead()
})
useEventListener(window, 'online', reopenIfDead)

onMounted(async () => {
  if (spectating) {
    everOpened = true
    open()
    return
  }
  let status = { exists: true, full: false }
  try {
    status = await roomStatus(props.code, key.value)
  } catch {}
  if (!status.exists) {
    notFound.value = true
    stage.value = 'error'
    forgetKey()
    clearMoves()
    homeDeadline.value = Date.now() + 5000
  } else if (status.full) {
    roomFull.value = true
    stage.value = 'error'
  } else {
    everOpened = true
    open()
  }
})

function handleMessage(msg: ServerMessage) {
  switch (msg.type) {
    case 'joined':
      seat.value = msg.seat
      frameSeconds.value = msg.frameSeconds
      mode.value = msg.mode
      tournament.value = msg.tournament === true
      rematchAsked.value = false
      rematchConfig.value = false
      rematchInvite.value = false
      rematchProposal.value = null
      rematchDeadline.value = null
      inviteDeadline.value = null
      stage.value = 'waiting'
      break
    case 'lobby': {
      const opp = seat.value === 'black' ? 'white' : 'black'
      myReady.value = msg.ready[seat.value]
      oppReady.value = msg.ready[opp]
      oppLeft.value = !msg.present[opp]
      stage.value = msg.present[opp] || stage.value === 'ready' ? 'ready' : 'waiting'
      break
    }
    case 'start':
      resetReview()
      if (!spectating) restoreMoves(msg.state)
      game.value = msg.state
      deadline.value = msg.deadline === null ? null : Date.now() + (msg.deadline - msg.now)
      frameStart.value = Date.now() - msg.elapsed
      // 大赛对局逐帧变时限，进度条分母跟随当前帧（与 Room DO 的 scheduleFrame 一致）。
      frameSeconds.value = tournament.value ? tournamentFrameSeconds(msg.state.frame) : msg.frameSeconds
      submitted.value = msg.submitted[seat.value]
      oppSubmitted.value = msg.submitted[seat.value === 'black' ? 'white' : 'black']
      selected.value = msg.yourChoice
      lastMoves.value = msg.state.lastMoves
      vanishing.value = []
      rematchAsked.value = false
      rematchInvite.value = false
      rematchDeadline.value = null
      inviteDeadline.value = null
      overlayDismissed.value = false
      errorNotice.value = ''
      showConcede.value = false
      drawInvite.value = false
      drawInviteDeadline.value = null
      stage.value = msg.state.phase === 'playing' ? 'playing' : 'over'
      break
    case 'frame_settled':
      if (!spectating && msg.passed.includes(seat.value === 'black' ? 'white' : 'black')) {
        showToast('对方上一回合弃着')
      }
      if (!spectating) {
        recordFrame(msg.state)
        if (msg.moves) logMove(msg.moves)
      }
      lastMoves.value = msg.state.lastMoves
      vanishing.value = msg.state.cleared
      game.value = msg.state
      if (tournament.value) frameSeconds.value = tournamentFrameSeconds(msg.state.frame)
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
    case 'opponent_resigned':
      showConcede.value = false
      showToast(msg.left ? '对方退出房间，本局你获胜' : '对方认输，本局你获胜')
      break
    case 'draw_offered':
      drawInvite.value = true
      drawInviteDeadline.value = Date.now() + 5000
      break
    case 'draw_declined':
      showToast('对方拒绝了求和')
      break
    case 'players':
      seatAccounts.value = msg.accounts
      break
    case 'room_closed':
      roomClosed.value = true
      forgetKey()
      clearMoves()
      break
    case 'rematch_requested':
      rematchProposal.value = { frameSeconds: msg.frameSeconds, mode: msg.mode }
      rematchAsked.value = false
      rematchDeadline.value = null
      rematchInvite.value = true
      inviteDeadline.value = Date.now() + 30_000
      break
    case 'rematch_declined':
      rematchAsked.value = false
      rematchDeadline.value = null
      showToast('对方拒绝了再来一局')
      break
    case 'error':
      errorNotice.value = msg.message
      break
  }
}

const { secondsLeft, remainingRatio, urgency, elapsedSeconds, overdue } = useFrameClock(
  deadline,
  frameSeconds,
  frameStart,
  () => stage.value === 'playing',
)

const oppStatus = computed(() => {
  if (oppLeft.value)
    return { text: '对方已离开', dot: 'bg-red-500', cls: 'text-red-600 dark:text-red-400' }
  if (stage.value === 'over')
    return { text: '对局结束', dot: 'bg-stone-400', cls: 'text-stone-500 dark:text-stone-400' }
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
  return { text: '对方思考中', dot: 'bg-amber-400', cls: 'text-stone-500 dark:text-stone-400' }
})

const modeLabel = computed(() => MODE_LABELS[mode.value])

const seatLabel = computed(() => (seat.value === 'black' ? '你执黑' : '你执白'))

const { char: resultChar, colors: resultColors, textCls: resultTextCls } = useGameResult(game, seat)

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
  if (autoSubmit.value || submitted.value) {
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

function resign() {
  showConcede.value = false
  send(JSON.stringify({ type: 'resign' } satisfies ClientMessage))
}

function offerDraw() {
  showConcede.value = false
  send(JSON.stringify({ type: 'draw_offer' } satisfies ClientMessage))
  showToast('已向对方发起求和')
}

function respondDraw(accept: boolean) {
  if (!drawInvite.value) return
  drawInvite.value = false
  drawInviteDeadline.value = null
  send(JSON.stringify({ type: 'draw_response', accept } satisfies ClientMessage))
}

const drawInviteSeconds = useCountdown(drawInviteDeadline, 5)

watch(drawInviteSeconds, (s) => {
  if (s === 0) respondDraw(false)
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
  rematchDeadline.value = Date.now() + 30_000
}

const rematchSecondsLeft = useCountdown(rematchDeadline, 30)

watch(rematchSecondsLeft, (s) => {
  if (s === 0) {
    rematchDeadline.value = null
    rematchAsked.value = false
  }
})

function confirmRematch() {
  rematchConfig.value = false
  sendRematch(rematchFrame.value, rematchMode.value)
}

const inviteSecondsLeft = useCountdown(inviteDeadline, 30)

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

const homeSecondsLeft = useCountdown(homeDeadline, 5)

watch(homeSecondsLeft, (s) => {
  if (s === 0) backOrReplace()
})

// 大赛对局结束后不自动跳转，可留在棋盘复盘；下一轮开始（轮次推进或配到新对局）才倒计时回大厅。
const tournamentReturn = ref<number | null>(null)
const tournamentReturnLeft = useCountdown(tournamentReturn, 5)

watch(tournamentReturnLeft, (s) => {
  if (s === 0) backOrReplace('/tournament')
})

const tournamentRound = ref<number | null>(null)
const { open: watchNextRound } = useWebSocket(tournamentWsUrl(), {
  immediate: false,
  autoReconnect: { delay: 3000 },
  heartbeat: {
    message: 'ping',
    responseMessage: 'pong',
    interval: 20_000,
    pongTimeout: 10_000,
  },
  onMessage(_ws, event) {
    const info = JSON.parse(event.data as string) as TournamentInfo
    if (info.state !== 'active') return
    tournamentRound.value ??= info.round
    const nextGame = info.myGame !== null && info.myGame.code !== props.code
    if ((info.round > tournamentRound.value || nextGame) && tournamentReturn.value === null) {
      tournamentReturn.value = Date.now() + 5000
    }
  },
})

watch(stage, (s) => {
  if (s === 'over' && tournament.value) watchNextRound()
})

// 翻回合时顺带收起结果遮罩，露出棋盘。
function review(delta: number) {
  overlayDismissed.value = true
  stepReview(delta)
}

// 对局中 frame 表示「正在下第 N 回合」；回放与终局态按已下完的回合数显示（引擎 +1 过）。
const displayFrame = computed(() => {
  const state = reviewState.value ?? game.value
  if (!state) return null
  return state.phase === 'playing' && !reviewState.value ? state.frame : state.frame - 1
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
  if (spectating) return backOrReplace('/tournament')
  clearMoves()
  send(JSON.stringify({ type: 'leave' } satisfies ClientMessage))
  forgetKey()
  setTimeout(() => backOrReplace(), 150)
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

    <RoomWaiting
      v-else-if="stage === 'waiting' && !tournament"
      :code="props.code"
      :url="roomUrl"
      :frame-seconds="frameSeconds"
      :mode="mode"
    />

    <RoomReady
      v-else-if="stage === 'ready' || (stage === 'waiting' && tournament)"
      :code="props.code"
      :frame-seconds="frameSeconds"
      :tournament="tournament"
      :mode="mode"
      :seat="seat"
      :my-ready="myReady"
      :opp-ready="oppReady"
      :opp-left="oppLeft"
      @ready="sendReady"
    />

    <template v-else-if="stage === 'playing' || stage === 'over'">
      <div class="flex w-full max-w-md flex-1 flex-col justify-center gap-3">
        <div class="grid grid-cols-[1fr_auto_1fr] items-center text-sm">
          <span class="flex items-center gap-1.5 justify-self-start font-medium text-stone-700 dark:text-stone-200">
            <IconStones v-if="spectating" class="h-4" />
            <template v-else>
              <IconStone :seat="seat" class="size-3.5" />
              {{ seatLabel }}
              <template v-if="stage === 'over'">
                ·
                <span class="font-semibold" :class="resultTextCls">{{ resultChar }}</span>
              </template>
            </template>
          </span>
          <span class="flex items-center gap-1.5 rounded-full bg-white/70 px-3 py-0.5 text-xs text-stone-500 dark:bg-stone-800/70 dark:text-stone-400">
            <IconHome class="size-3.5" />
            {{ props.code }}
            <button
              class="cursor-pointer text-red-400 transition-colors hover:text-red-600"
              aria-label="退出房间"
              @click="spectating ? exitRoom() : (confirmingExit = true)"
            >
              <IconLogout class="size-3.5" />
            </button>
          </span>
          <button
            class="flex cursor-pointer items-center gap-1 justify-self-end font-medium text-stone-500 transition-colors hover:text-stone-700 active:text-stone-700 dark:text-stone-400 dark:hover:text-stone-200 dark:active:text-stone-200"
            @click="showRules = true"
          >
            <template v-if="modeLabel">{{ modeLabel }}模式</template>
            <IconHelp class="size-4" />
          </button>
        </div>

        <div class="grid grid-cols-[1fr_auto_1fr] items-center text-sm">
          <span class="justify-self-start font-medium text-stone-700 dark:text-stone-200">第 {{ displayFrame }} 回合</span>
          <span
            v-if="spectating"
            class="flex items-center gap-1.5 text-stone-500 dark:text-stone-400"
          >
            <span class="size-2 rounded-full bg-emerald-500" />
            观战中
          </span>
          <span v-else class="flex items-center gap-1.5" :class="oppStatus.cls">
            <span class="size-2 rounded-full" :class="oppStatus.dot" />
            {{ oppStatus.text }}
          </span>
          <FrameTimer
            :frame-seconds="frameSeconds"
            :seconds-left="secondsLeft"
            :elapsed-seconds="elapsedSeconds"
            :urgency="urgency"
          />
        </div>

        <FrameBar v-if="frameSeconds > 0" :remaining-ratio="remainingRatio" :urgency="urgency" />

        <div class="relative w-full">
          <Board
            v-if="reviewState ?? game"
            :state="(reviewState ?? game)!"
            :seat="seat"
            :selected="reviewState ? null : selected"
            :submitted="submitted"
            :last-moves="reviewState ? reviewState.lastMoves : lastMoves"
            :vanishing="reviewState ? [] : vanishing"
            :interactive="stage === 'playing' && !spectating && (!submitted || !oppSubmitted)"
            @select="select"
          />
          <ResultOverlay
            v-if="stage === 'over' && !overlayDismissed && !spectating"
            :char="resultChar"
            :colors="resultColors"
            @dismiss="overlayDismissed = true"
          />
        </div>

        <template v-if="stage === 'playing' && !spectating">
          <AppButton
            v-if="!autoSubmit"
            class="w-full"
            :disabled="!selected || submitted"
            @click="submitChoice"
          >
            {{ submitted ? '已提交，等待对方' : selected ? '确认提交' : '点击棋盘选择落点' }}
          </AppButton>
          <p v-else class="min-h-4 text-center text-xs text-stone-400 dark:text-stone-500">
            {{ submitted ? '已提交，等待对方' : '点击棋盘落子即提交' }}
          </p>
          <p class="min-h-4 text-center text-xs text-stone-400 dark:text-stone-500">
            <template v-if="errorNotice">{{ errorNotice }}</template>
            <template v-else-if="frameSeconds > 0 && selected && !submitted">
              倒计时结束将自动提交已选落点
            </template>
            <template v-else-if="submitted && !oppSubmitted">对方提交前仍可变更落点</template>
          </p>
          <div class="grid grid-cols-[1fr_auto_1fr] items-center">
            <span />
            <div class="flex items-center justify-center gap-1">
              <button
                class="cursor-pointer p-1 text-stone-400 transition-colors hover:text-stone-600 active:text-stone-600 dark:text-stone-500 dark:hover:text-stone-300 dark:active:text-stone-300"
                aria-label="对局设置"
                @click="showSettings = true"
              >
                <IconSettings class="size-5" />
              </button>
              <button
                v-if="seatAccounts.black || seatAccounts.white"
                class="cursor-pointer p-1 text-stone-400 transition-colors hover:text-stone-600 active:text-stone-600 dark:text-stone-500 dark:hover:text-stone-300 dark:active:text-stone-300"
                aria-label="玩家信息"
                @click="showPlayers = true"
              >
                <IconUsers class="size-5" />
              </button>
            </div>
            <button
              class="cursor-pointer justify-self-end p-1 text-xs font-medium text-stone-400 transition-colors hover:text-red-500 active:text-red-500 dark:text-stone-500 dark:hover:text-red-400 dark:active:text-red-400"
              @click="showConcede = true"
            >
              认输/求和
            </button>
          </div>
        </template>

        <template v-else-if="tournament">
          <AppButton class="w-full" @click="backOrReplace('/tournament')">
            返回每日大赛<template v-if="tournamentReturnLeft !== null">（{{ tournamentReturnLeft }}s）</template>
          </AppButton>
        </template>

        <template v-else>
          <AppButton
            v-if="!roomClosed"
            class="w-full"
            :disabled="rematchAsked"
            @click="openRematchConfig"
          >
            {{ rematchAsked ? `等待对方…${rematchSecondsLeft}s` : '邀请对方再来一局' }}
          </AppButton>
          <p v-else class="text-center text-sm text-stone-500 dark:text-stone-400">对方已退出，房间已关闭</p>
        </template>

        <div v-if="stage === 'over' && reviewAvailable" class="flex w-full gap-2">
          <AppButton secondary class="flex-1" :disabled="reviewAtFirst" @click="review(-1)">
            上一回合
          </AppButton>
          <AppButton secondary class="flex-1" :disabled="reviewAtLatest" @click="review(1)">
            下一回合
          </AppButton>
        </div>

        <div v-if="spectating" class="flex justify-center">
          <button
            class="cursor-pointer p-1 text-stone-400 transition-colors hover:text-stone-600 active:text-stone-600 dark:text-stone-500 dark:hover:text-stone-300 dark:active:text-stone-300"
            aria-label="玩家信息"
            @click="showPlayers = true"
          >
            <IconUsers class="size-5" />
          </button>
        </div>
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
            <AppButton class="w-full" @click="backOrReplace()">
              返回首页<template v-if="homeSecondsLeft !== null">（{{ homeSecondsLeft }}s）</template>
            </AppButton>
          </div>
        </template>
      </div>
    </template>

    <RematchInviteDialog
      v-if="rematchInvite"
      :proposal="rematchProposal"
      :seconds-left="inviteSecondsLeft"
      @accept="acceptRematch"
      @decline="declineRematch"
    />

    <GameConfigDialog
      v-if="rematchConfig"
      v-model:frame="rematchFrame"
      v-model:mode="rematchMode"
      title="再来一局"
      confirm-text="发起邀请"
      @cancel="rematchConfig = false"
      @confirm="confirmRematch"
    />

    <AppDialog v-if="confirmingExit" title="退出房间？" :closable="false">
      <p class="text-sm text-stone-500 dark:text-stone-400">
        {{
          stage === 'playing'
            ? '退出即认输，判对方获胜，房间将关闭。'
            : '退出后房间将关闭。'
        }}
      </p>
      <template #footer>
        <div class="flex gap-2">
          <DialogButton variant="secondary" @click="confirmingExit = false">取消</DialogButton>
          <DialogButton variant="danger" @click="exitRoom">退出</DialogButton>
        </div>
      </template>
    </AppDialog>

    <AppDialog v-if="showConcede" title="认输/求和" @close="showConcede = false">
      <p class="text-sm text-stone-500 dark:text-stone-400">
        认输将判对方获胜；求和需对方同意，同意后本局记为平局。
      </p>
      <template #footer>
        <div class="flex gap-2">
          <DialogButton variant="secondary" @click="offerDraw">求和</DialogButton>
          <DialogButton variant="danger" @click="resign">认输</DialogButton>
        </div>
      </template>
    </AppDialog>

    <AppDialog v-if="drawInvite" title="对方求和" :closable="false">
      <p class="text-sm text-stone-500 dark:text-stone-400">
        对方提议和棋，同意后本局记为平局。{{ drawInviteSeconds }} 秒后自动拒绝。
      </p>
      <template #footer>
        <div class="flex gap-2">
          <DialogButton variant="secondary" @click="respondDraw(false)">拒绝</DialogButton>
          <DialogButton @click="respondDraw(true)">同意</DialogButton>
        </div>
      </template>
    </AppDialog>

    <AppDialog v-if="showSettings" title="对局设置" @close="showSettings = false">
      <AppSwitch v-model="autoSubmit">落子自动提交</AppSwitch>
    </AppDialog>

    <PlayersDialog
      v-if="showPlayers"
      :accounts="seatAccounts"
      :seat="seat"
      :spectator="spectating"
      @close="showPlayers = false"
    />

    <RulesDialog v-if="showRules" @close="showRules = false" />

    <div class="pointer-events-none fixed inset-x-0 top-6 z-50 flex justify-center">
      <Transition
        enter-active-class="transition duration-200 ease-out"
        enter-from-class="-translate-y-2 opacity-0"
        leave-active-class="transition duration-200 ease-in"
        leave-to-class="opacity-0"
      >
        <span
          v-if="toast"
          class="rounded-full bg-stone-800/90 px-4 py-2 text-sm text-white shadow-lg dark:bg-stone-200/90 dark:text-stone-900"
        >
          {{ toast }}
        </span>
      </Transition>
    </div>
  </main>
</template>
