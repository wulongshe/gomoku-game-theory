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
import MeleeLobby from '~/components/MeleeLobby.vue'
import ResultOverlay from '~/components/ResultOverlay.vue'
import IconCross from '~/components/icons/IconCross.vue'
import IconHelp from '~/components/icons/IconHelp.vue'
import IconHome from '~/components/icons/IconHome.vue'
import IconLogout from '~/components/icons/IconLogout.vue'
import IconSettings from '~/components/icons/IconSettings.vue'
import IconStone from '~/components/icons/IconStone.vue'
import { meleeStatus, meleeWsUrl } from '~/apis'
import { useCountdown } from '~/composables/useCountdown'
import { useFrameClock } from '~/composables/useFrameClock'
import { useGameReview } from '~/composables/useGameReview'
import { MELEE_KEY_PREFIX } from '~/constants/storage'
import { backOrReplace } from '~/utils/navigation'
import { COLOR_LABELS, MELEE_TITLE, meleeRules } from '@gomoku/branding'
import type { Point } from '@gomoku/engine/game'
import {
  isLegalMeleeChoice,
  MELEE_FRAME_SECONDS,
  type Color,
  type MeleeClearedGroup,
  type MeleeState,
} from '@gomoku/engine/melee'
import type { MeleeClientMessage, MeleeServerMessage } from '@/shared/protocol'

const props = defineProps<{ code: string }>()

const roomUrl = location.href
const RULES = meleeRules()
const MEDALS = ['🥇', '🥈', '🥉']
const RANK_CHARS = ['冠', '亚', '季', '四', '五']

type Stage = 'connecting' | 'lobby' | 'playing' | 'over' | 'error'

const stage = ref<Stage>('connecting')
const seat = ref<Color>('black')
const seats = ref<Color[]>([])
const present = ref<Color[]>([])
const readySeats = ref<Color[]>([])
const game = ref<MeleeState | null>(null)
const {
  state: reviewState,
  atFirst: reviewAtFirst,
  atLatest: reviewAtLatest,
  available: reviewAvailable,
  record: recordFrame,
  reset: resetReview,
  step: stepReview,
} = useGameReview<MeleeState>()
const deadline = ref<number | null>(null)
const frameStart = ref<number | null>(null)
const frameSeconds = ref(MELEE_FRAME_SECONDS)
const selected = ref<Point | null>(null)
const submitted = ref(false)
const submittedSeats = ref<Color[]>([])
const lastMoves = ref<Point[]>([])
const vanishing = ref<MeleeClearedGroup[]>([])
const overlayDismissed = ref(false)
const errorNotice = ref('')
const confirmingExit = ref(false)
const roomClosed = ref(false)
const notFound = ref(false)
const roomFull = ref(false)
const showRules = ref(false)
const showSettings = ref(false)
const autoSubmit = useStorage('auto-submit', false)
const toast = ref('')

let toastTimer: ReturnType<typeof setTimeout> | undefined
function showToast(message: string) {
  toast.value = message
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toast.value = ''), 3000)
}

const key = useStorage(`${MELEE_KEY_PREFIX}${props.code}`, nanoid())

function forgetKey() {
  localStorage.removeItem(`${MELEE_KEY_PREFIX}${props.code}`)
}

let replaced = false
let everOpened = false
const {
  send,
  open,
  status: wsStatus,
} = useWebSocket(meleeWsUrl(props.code, key.value), {
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
    handleMessage(JSON.parse(event.data as string) as MeleeServerMessage)
  },
  onDisconnected(_ws, event) {
    if (event.reason === 'replaced by reconnect') replaced = true
    if (event.reason === 'room closed') {
      roomClosed.value = true
      forgetKey()
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

const homeDeadline = ref<number | null>(null)
const homeSecondsLeft = useCountdown(homeDeadline, 5)
watch(homeSecondsLeft, (s) => {
  if (s === 0) backOrReplace()
})

onMounted(async () => {
  let status = { exists: true, full: false }
  try {
    status = await meleeStatus(props.code, key.value)
  } catch {}
  if (!status.exists) {
    notFound.value = true
    stage.value = 'error'
    forgetKey()
    homeDeadline.value = Date.now() + 5000
  } else if (status.full) {
    roomFull.value = true
    stage.value = 'error'
  } else {
    everOpened = true
    open()
  }
})

function applyState(state: MeleeState) {
  game.value = state
  lastMoves.value = state.lastMoves
  vanishing.value = state.cleared
  if (state.phase !== 'playing') stage.value = 'over'
}

function handleMessage(msg: MeleeServerMessage) {
  switch (msg.type) {
    case 'joined':
      seat.value = msg.seat
      seats.value = msg.seats
      frameSeconds.value = msg.frameSeconds
      stage.value = 'lobby'
      break
    case 'lobby':
      present.value = msg.present
      readySeats.value = msg.ready
      break
    case 'start':
      resetReview()
      applyState(msg.state)
      deadline.value = msg.deadline === null ? null : Date.now() + (msg.deadline - msg.now)
      frameStart.value = Date.now() - msg.elapsed
      submittedSeats.value = msg.submitted
      submitted.value = msg.submitted.includes(seat.value)
      selected.value = msg.yourChoice
      overlayDismissed.value = false
      errorNotice.value = ''
      stage.value = msg.state.phase === 'playing' ? 'playing' : 'over'
      break
    case 'frame_settled': {
      const before = game.value
      recordFrame(msg.state)
      applyState(msg.state)
      deadline.value = msg.deadline === null ? null : Date.now() + (msg.deadline - msg.now)
      frameStart.value = Date.now()
      selected.value = null
      submitted.value = false
      submittedSeats.value = []
      errorNotice.value = ''
      const finished = msg.state.ranking.filter((c) => !before?.ranking.includes(c))
      if (finished.length && msg.state.phase === 'playing') {
        showToast(`${finished.map((c) => COLOR_LABELS[c]).join('、')}方连五完赛`)
      }
      break
    }
    case 'submitted':
      submittedSeats.value = msg.submitted
      submitted.value = msg.submitted.includes(seat.value)
      break
    case 'dropped':
      applyState(msg.state)
      showToast(`${COLOR_LABELS[msg.seat]}方退出了对局`)
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

const active = computed(() => game.value?.active.includes(seat.value) ?? false)
const myRank = computed(() => {
  const i = game.value?.ranking.indexOf(seat.value) ?? -1
  return i < 0 ? null : i + 1
})
const droppedOut = computed(() => game.value?.out.includes(seat.value) ?? false)

const status = computed(() => {
  if (stage.value === 'over')
    return { text: '对局结束', dot: 'bg-stone-400', cls: 'text-stone-500 dark:text-stone-400' }
  if (overdue.value)
    return { text: '结算中…', dot: 'animate-pulse bg-stone-400', cls: 'text-stone-500 dark:text-stone-400' }
  const n = submittedSeats.value.length
  const all = n > 0 && n >= (game.value?.active.length ?? 0)
  return {
    text: `${n} 人已提交`,
    dot: all ? 'bg-emerald-500' : n ? 'bg-amber-400' : 'bg-stone-400',
    cls: all ? 'text-emerald-700 dark:text-emerald-400' : 'text-stone-500 dark:text-stone-400',
  }
})

const seatLabel = computed(() => `你执${COLOR_LABELS[seat.value]}`)

const resultText = computed(() => {
  if (myRank.value !== null) return `第${myRank.value}名`
  if (droppedOut.value) return '已退出'
  return ''
})

const result = computed(() => {
  if (droppedOut.value)
    return { char: '退', colors: ['#a8a29e', '#57534e'], cls: 'text-stone-400 dark:text-stone-500' }
  const rank = myRank.value ?? RANK_CHARS.length
  const char = RANK_CHARS[Math.min(rank, RANK_CHARS.length) - 1]
  if (rank === 1) return { char, colors: ['#fbbf24', '#d97706'], cls: 'text-amber-500 dark:text-amber-400' }
  if (rank === 2) return { char, colors: ['#e7e5e4', '#a8a29e'], cls: 'text-stone-500 dark:text-stone-300' }
  if (rank === 3) return { char, colors: ['#d6a267', '#9a5b2b'], cls: 'text-orange-700 dark:text-orange-400' }
  return { char, colors: ['#a8a29e', '#57534e'], cls: 'text-stone-400 dark:text-stone-500' }
})

// 完赛榜：连五者按名次排列，终局后剩下的人垫底入榜。
const ranking = computed(() =>
  (game.value?.ranking ?? []).map((color, i) => ({ color, medal: MEDALS[i] ?? `${i + 1}.` })),
)

function sendChoice(point: Point, final: boolean) {
  if (!game.value) return
  const msg: MeleeClientMessage = { type: 'submit', frame: game.value.frame, point, final }
  send(JSON.stringify(msg))
}

const allSubmitted = computed(
  () => game.value !== null && submittedSeats.value.length >= game.value.active.length,
)

function select(point: Point) {
  if (stage.value !== 'playing' || !game.value || !active.value) return
  if (submitted.value && allSubmitted.value) return
  if (!isLegalMeleeChoice(game.value, seat.value, point)) return
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

function cancelChoice() {
  if (!game.value || !selected.value || !submitted.value || allSubmitted.value) return
  sendChoice(selected.value, false)
  submitted.value = false
}

watch(autoSubmit, (on) => {
  if (on && stage.value === 'playing') submitChoice()
})

function sendReady() {
  send(JSON.stringify({ type: 'ready' } satisfies MeleeClientMessage))
}

function review(delta: number) {
  overlayDismissed.value = true
  stepReview(delta)
}

const displayFrame = computed(() => {
  const state = reviewState.value ?? game.value
  if (!state) return null
  return state.phase === 'playing' && !reviewState.value ? state.frame : state.frame - 1
})

const errorInfo = computed(() => {
  if (notFound.value)
    return { title: '房间不存在或已关闭', desc: '链接可能已失效，房间空置后会自动关闭' }
  if (roomFull.value) return { title: '房间已满', desc: '座位都已有人，回首页自己开一局吧' }
  return { title: '无法加入房间', desc: '连接失败，请检查网络后重试' }
})

function reload() {
  location.reload()
}

function exitRoom() {
  send(JSON.stringify({ type: 'leave' } satisfies MeleeClientMessage))
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
          <span class="size-2.5 animate-[breathe_1.2s_ease-in-out_0.2s_infinite] rounded-full bg-stone-500 dark:bg-stone-400" />
          <span class="size-2.5 animate-[breathe_1.2s_ease-in-out_0.4s_infinite] rounded-full bg-stone-500 dark:bg-stone-400" />
        </div>
        <p class="text-stone-600 dark:text-stone-300">正在连接房间 {{ props.code }}…</p>
      </div>
    </template>

    <MeleeLobby
      v-else-if="stage === 'lobby'"
      :code="props.code"
      :url="roomUrl"
      :frame-seconds="frameSeconds"
      :seat="seat"
      :seats="seats"
      :present="present"
      :ready="readySeats"
      @ready="sendReady"
    />

    <template v-else-if="stage === 'playing' || stage === 'over'">
      <div class="flex w-full max-w-md flex-1 flex-col gap-3">
        <div class="grid grid-cols-[1fr_auto_1fr] items-center text-sm">
          <span class="flex items-center gap-1.5 justify-self-start whitespace-nowrap font-medium text-stone-700 dark:text-stone-200">
            <IconStone :seat="seat" mooncake class="size-4" />
            {{ seatLabel }}
            <template v-if="resultText">
              ·
              <span class="font-semibold" :class="result.cls">{{ resultText }}</span>
            </template>
          </span>
          <span class="flex items-center gap-1.5 rounded-full bg-white/70 px-3 py-0.5 text-xs text-stone-500 dark:bg-stone-800/70 dark:text-stone-400">
            <IconHome class="size-3.5" />
            {{ props.code }}
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
            玩法
            <IconHelp class="size-4" />
          </button>
        </div>

        <div class="grid grid-cols-[1fr_auto_1fr] items-center text-sm">
          <span class="justify-self-start font-medium text-stone-700 dark:text-stone-200">第 {{ displayFrame }} 回合</span>
          <span class="flex items-center gap-1.5" :class="status.cls">
            <span class="size-2 rounded-full" :class="status.dot" />
            {{ status.text }}
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
            :vanishing="reviewState ? reviewState.cleared : vanishing"
            :interactive="stage === 'playing' && active && (!submitted || !allSubmitted)"
            mooncake
            @select="select"
          />
          <ResultOverlay
            v-if="stage === 'over' && !overlayDismissed"
            :char="result.char"
            :colors="result.colors"
            @dismiss="overlayDismissed = true"
          />
        </div>

        <template v-if="stage === 'playing' && active">
          <AppButton
            class="w-full"
            :disabled="submitted ? allSubmitted : !selected"
            @click="submitted ? cancelChoice() : submitChoice()"
          >
            {{
              submitted
                ? '取消提交'
                : selected
                  ? '确认提交'
                  : autoSubmit
                    ? '点击棋盘落子即提交'
                    : '点击棋盘选择落点'
            }}
          </AppButton>
          <p class="min-h-4 text-center text-xs text-stone-400 dark:text-stone-500">
            <template v-if="errorNotice">{{ errorNotice }}</template>
            <template v-else-if="frameSeconds > 0 && selected && !submitted">
              倒计时结束将自动提交已选落点
            </template>
            <template v-else-if="submitted && !allSubmitted">全员提交前可取消或变更落点</template>
          </p>
        </template>
        <p v-else-if="stage === 'playing'" class="py-3 text-center text-sm text-stone-500 dark:text-stone-400">
          {{ droppedOut ? '你已退出，观战中' : `你已完赛，${resultText}，观战中` }}
        </p>
        <div v-else-if="reviewAvailable" class="flex w-full gap-2">
          <AppButton secondary class="flex-1" :disabled="reviewAtFirst" @click="review(-1)">
            上一回合
          </AppButton>
          <AppButton secondary class="flex-1" :disabled="reviewAtLatest" @click="review(1)">
            下一回合
          </AppButton>
        </div>

        <div class="mt-auto flex flex-col gap-3">
          <div class="flex flex-col items-center gap-1.5 rounded-xl bg-white/70 px-4 py-2 text-sm dark:bg-stone-800/70">
            <span class="text-xs text-stone-400 dark:text-stone-500">完赛排名</span>
            <div class="flex min-h-6 flex-wrap items-center justify-center gap-x-4 gap-y-1">
              <template v-if="ranking.length">
                <span
                  v-for="entry in ranking"
                  :key="entry.color"
                  class="flex items-center gap-1 font-medium text-stone-700 dark:text-stone-200"
                >
                  <span>{{ entry.medal }}</span>
                  <IconStone :seat="entry.color" mooncake class="size-4" />
                  {{ COLOR_LABELS[entry.color] }}
                  <span v-if="entry.color === seat" class="text-xs text-stone-400 dark:text-stone-500">(你)</span>
                </span>
              </template>
              <span v-else class="text-xs text-stone-400 dark:text-stone-500">尚无人完赛</span>
              <span
                v-for="color in game?.out ?? []"
                :key="`out-${color}`"
                class="flex items-center gap-1 text-stone-400 line-through dark:text-stone-500"
              >
                <IconStone :seat="color" mooncake class="size-4 opacity-50" />
                {{ COLOR_LABELS[color] }}
              </span>
            </div>
          </div>

          <div class="grid grid-cols-[1fr_auto_1fr] items-center">
            <button
              class="cursor-pointer justify-self-start p-1 text-xs font-medium text-stone-400 transition-colors hover:text-stone-600 active:text-stone-600 dark:text-stone-500 dark:hover:text-stone-300 dark:active:text-stone-300"
              @click="stage === 'over' ? exitRoom() : (confirmingExit = true)"
            >
              返回首页
            </button>
            <button
              class="cursor-pointer p-1 text-stone-400 transition-colors hover:text-stone-600 active:text-stone-600 dark:text-stone-500 dark:hover:text-stone-300 dark:active:text-stone-300"
              aria-label="对局设置"
              @click="showSettings = true"
            >
              <IconSettings class="size-5" />
            </button>
            <span />
          </div>
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

    <AppDialog v-if="confirmingExit" title="退出房间？" :closable="false">
      <p class="text-sm text-stone-500 dark:text-stone-400">
        {{ stage === 'playing' && active ? '退出即离场，不计名次，其他人继续对局。' : '退出后其他人继续对局。' }}
      </p>
      <template #footer>
        <div class="flex gap-2">
          <DialogButton variant="secondary" @click="confirmingExit = false">取消</DialogButton>
          <DialogButton variant="danger" @click="exitRoom">退出</DialogButton>
        </div>
      </template>
    </AppDialog>

    <AppDialog v-if="showSettings" title="对局设置" @close="showSettings = false">
      <AppSwitch v-model="autoSubmit">落子自动提交</AppSwitch>
    </AppDialog>

    <AppDialog v-if="showRules" :title="`${MELEE_TITLE} · 玩法`" @close="showRules = false">
      <div class="flex flex-col gap-4 text-sm">
        <div v-for="section in RULES" :key="section.title" class="flex flex-col gap-1.5">
          <p class="font-semibold text-stone-800 dark:text-stone-100">{{ section.title }}</p>
          <ul class="flex list-disc flex-col gap-1 pl-5 text-stone-600 dark:text-stone-300">
            <li v-for="item in section.items" :key="item">{{ item }}</li>
          </ul>
        </div>
      </div>
    </AppDialog>

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
