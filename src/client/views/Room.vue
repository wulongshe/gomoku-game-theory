<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useStorage, useTimestamp, useWebSocket } from '@vueuse/core'
import { nanoid } from 'nanoid'
import AppButton from '~/components/AppButton.vue'
import AppDialog from '~/components/AppDialog.vue'
import Board from '~/components/Board.vue'
import DialogButton from '~/components/DialogButton.vue'
import GameConfigDialog from '~/components/GameConfigDialog.vue'
import RematchInviteDialog from '~/components/RematchInviteDialog.vue'
import ResultOverlay from '~/components/ResultOverlay.vue'
import RoomReady from '~/components/RoomReady.vue'
import RoomWaiting from '~/components/RoomWaiting.vue'
import RulesDialog from '~/components/RulesDialog.vue'
import IconCross from '~/components/icons/IconCross.vue'
import IconHelp from '~/components/icons/IconHelp.vue'
import IconLogout from '~/components/icons/IconLogout.vue'
import IconStone from '~/components/icons/IconStone.vue'
import { roomStatus, roomWsUrl } from '~/apis'
import { useCountdown } from '~/composables/useCountdown'
import { MODE_LABELS } from '~/constants/branding'
import {
  FRAME_SECONDS,
  isLegalChoice,
  type ClearedGroup,
  type GameMode,
  type GameState,
  type Point,
  type Seat,
} from '@/engine/game'
import { type ClientMessage, type ServerMessage } from '@/shared/protocol'

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
const rematchDeadline = ref<number | null>(null)
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

const token = useStorage(`room-token:${props.code}`, nanoid())

function forgetToken() {
  localStorage.removeItem(`room-token:${props.code}`)
}
const now = useTimestamp({ interval: 250 })

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
      rematchDeadline.value = null
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
      rematchDeadline.value = null
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
    case 'room_closed':
      roomClosed.value = true
      forgetToken()
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

const secondsLeft = useCountdown(deadline, frameSeconds)

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

const winnerSeat = computed<Seat | null>(() => {
  if (game.value?.phase === 'black_won') return 'black'
  if (game.value?.phase === 'white_won') return 'white'
  return null
})

const resultChar = computed(() => {
  if (!winnerSeat.value) return '和'
  return winnerSeat.value === seat.value ? '赢' : '输'
})

const resultColors = computed(() => {
  if (!winnerSeat.value) return ['#10b981', '#047857']
  return winnerSeat.value === seat.value ? ['#fbbf24', '#d97706'] : ['#a8a29e', '#57534e']
})

const resultTextCls = computed(() => {
  if (!winnerSeat.value) return 'text-emerald-600 dark:text-emerald-400'
  return winnerSeat.value === seat.value
    ? 'text-amber-500 dark:text-amber-400'
    : 'text-stone-400 dark:text-stone-500'
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

    <RoomWaiting
      v-else-if="stage === 'waiting'"
      :code="props.code"
      :url="roomUrl"
      :frame-seconds="frameSeconds"
      :mode="mode"
    />

    <RoomReady
      v-else-if="stage === 'ready'"
      :code="props.code"
      :frame-seconds="frameSeconds"
      :mode="mode"
      :seat="seat"
      :my-ready="myReady"
      :opp-ready="oppReady"
      @ready="sendReady"
    />

    <template v-else-if="stage === 'playing' || stage === 'over'">
      <div class="flex w-full max-w-md flex-1 flex-col justify-center gap-3">
        <div class="grid grid-cols-[1fr_auto_1fr] items-center text-sm">
          <span class="flex items-center gap-1.5 justify-self-start font-medium text-stone-700 dark:text-stone-200">
            <IconStone :seat="seat" class="size-3.5" />
            {{ seatLabel }}
            <template v-if="stage === 'over'">
              ·
              <span class="font-semibold" :class="resultTextCls">{{ resultChar }}</span>
            </template>
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
            <IconHelp class="size-4" />
          </button>
        </div>

        <div class="grid grid-cols-[1fr_auto_1fr] items-center text-sm">
          <span class="justify-self-start font-medium text-stone-700 dark:text-stone-200">第 {{ game?.frame }} 回合</span>
          <span class="flex items-center gap-1.5" :class="oppStatus.cls">
            <span class="size-2 rounded-full" :class="oppStatus.dot" />
            {{ oppStatus.text }}
          </span>
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
          <ResultOverlay
            v-if="stage === 'over' && !overlayDismissed"
            :char="resultChar"
            :colors="resultColors"
            @dismiss="overlayDismissed = true"
          />
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
            {{ rematchAsked ? `等待对方…${rematchSecondsLeft}s` : '邀请对方再来一局' }}
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
      <div class="flex gap-2">
        <DialogButton variant="secondary" @click="confirmingExit = false">取消</DialogButton>
        <DialogButton variant="danger" @click="exitRoom">退出</DialogButton>
      </div>
    </AppDialog>

    <RulesDialog v-if="showRules" @close="showRules = false" />
  </main>
</template>
