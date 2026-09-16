<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import AppButton from '~/components/AppButton.vue'
import AppDialog from '~/components/AppDialog.vue'
import Board from '~/components/Board.vue'
import DialogButton from '~/components/DialogButton.vue'
import FrameTimer from '~/components/FrameTimer.vue'
import ResultOverlay from '~/components/ResultOverlay.vue'
import IconHelp from '~/components/icons/IconHelp.vue'
import IconHome from '~/components/icons/IconHome.vue'
import IconStone from '~/components/icons/IconStone.vue'
import { type Difficulty } from '@gomoku/engine/ai'
import { challengeGame, challengeVerdict, type ChallengeVerdict } from '@gomoku/engine/challenge'
import {
  isLegalChoice,
  settleFrame,
  type ClearedGroup,
  type GameState,
  type Point,
} from '@gomoku/engine/game'
import { clearChallenge } from '~/apis'
import { CHALLENGE_ID, challengeBoard } from '~/challenges'
import { useAiOpponent } from '~/composables/useAiOpponent'
import { useAuth } from '~/composables/useAuth'
import { useChallengeProgress } from '~/composables/useChallengeProgress'
import { useFrameClock } from '~/composables/useFrameClock'
import { useGameReview } from '~/composables/useGameReview'
import { CHALLENGE_TITLE, challengeRules, DIFFICULTY_LABELS } from '@gomoku/branding'
import { DIFFICULTY_OPTIONS } from '@gomoku/config'
import { backOrReplace } from '~/utils/navigation'

const RULES = challengeRules()
const progress = useChallengeProgress(CHALLENGE_ID)
const { loggedIn } = useAuth()

// 未开启的难度回落到已开启的最高一档，并把地址栏同步成实际难度。
const requested = new URLSearchParams(location.search).get('difficulty') as Difficulty
const difficulty = ref<Difficulty>(
  DIFFICULTY_OPTIONS.includes(requested) && progress.unlocked(requested)
    ? requested
    : progress.highestUnlocked.value,
)
history.replaceState(null, '', `/challenge?difficulty=${difficulty.value}`)

const board = challengeBoard()
const game = ref<GameState>(challengeGame(board))
const verdict = ref<ChallengeVerdict>('playing')
const selected = ref<Point | null>(null)
const lastMoves = ref<Point[]>([])
const vanishing = ref<ClearedGroup[]>([])
const overlayDismissed = ref(false)
const showRules = ref(false)
const resolving = ref(false)
const deadline = ref<number | null>(null)
const frameStart = ref<number | null>(null)
const frameSeconds = 0

const {
  state: reviewState,
  atFirst: reviewAtFirst,
  atLatest: reviewAtLatest,
  available: reviewAvailable,
  record: recordFrame,
  reset: resetReview,
  step: stepReview,
} = useGameReview()
resetReview(game.value)

const ai = useAiOpponent()
let pendingAiMove: Promise<Point | null> | null = null

const playing = computed(() => verdict.value === 'playing')
const { secondsLeft, urgency, elapsedSeconds } = useFrameClock(
  deadline,
  frameSeconds,
  frameStart,
  playing,
)

const aiStatus = computed(() => {
  if (!playing.value)
    return { text: '挑战结束', dot: 'bg-stone-400', cls: 'text-stone-500 dark:text-stone-400' }
  if (ai.thinking.value)
    return { text: 'AI 思考中', dot: 'bg-amber-400', cls: 'text-stone-500 dark:text-stone-400' }
  return { text: 'AI 已提交', dot: 'bg-emerald-500', cls: 'text-emerald-700 dark:text-emerald-400' }
})

function beginFrame() {
  frameStart.value = Date.now()
  pendingAiMove = ai.request(game.value, 'white', difficulty.value)
}

let submitSeq = 0
function cancelChoice() {
  if (!resolving.value) return
  submitSeq++
  resolving.value = false
}

async function resolveFrame() {
  if (resolving.value || !playing.value) return
  resolving.value = true
  const seq = ++submitSeq
  const aiMove = await (pendingAiMove ?? ai.request(game.value, 'white', difficulty.value))
  if (seq !== submitSeq) return
  const next = settleFrame(game.value, { black: selected.value, white: aiMove })
  recordFrame(next)
  lastMoves.value = next.lastMoves
  vanishing.value = next.cleared
  game.value = next
  selected.value = null
  pendingAiMove = null
  resolving.value = false
  verdict.value = challengeVerdict(next)
  if (verdict.value === 'playing') {
    beginFrame()
  } else if (verdict.value === 'success') {
    progress.markCleared(difficulty.value)
    if (loggedIn.value) clearChallenge(CHALLENGE_ID, difficulty.value).catch(() => {})
  }
}

function select(point: Point) {
  if (!playing.value || resolving.value || !isLegalChoice(game.value, point)) return
  selected.value = point
}

function submitChoice() {
  if (!playing.value || !selected.value || resolving.value) return
  resolveFrame()
}

function review(delta: number) {
  overlayDismissed.value = true
  stepReview(delta)
}

const displayFrame = computed(() => {
  const state = reviewState.value ?? game.value
  return playing.value && !reviewState.value ? state.frame : state.frame - 1
})

const nextDifficulty = computed<Difficulty | null>(
  () => DIFFICULTY_OPTIONS[DIFFICULTY_OPTIONS.indexOf(difficulty.value) + 1] ?? null,
)

function restart(level: Difficulty = difficulty.value) {
  difficulty.value = level
  history.replaceState(null, '', `/challenge?difficulty=${level}`)
  game.value = challengeGame(board)
  resetReview(game.value)
  verdict.value = 'playing'
  selected.value = null
  lastMoves.value = []
  vanishing.value = []
  overlayDismissed.value = false
  pendingAiMove = null
  resolving.value = false
  beginFrame()
}

onMounted(beginFrame)

const result = computed(() =>
  verdict.value === 'success'
    ? { char: '成', colors: ['#fbbf24', '#d97706'], textCls: 'text-amber-500 dark:text-amber-400' }
    : { char: '败', colors: ['#a8a29e', '#57534e'], textCls: 'text-stone-400 dark:text-stone-500' },
)
</script>

<template>
  <main
    class="flex min-h-dvh flex-col items-center bg-gradient-to-b from-stone-100 to-stone-200 p-4 dark:from-stone-900 dark:to-stone-950"
  >
    <div class="flex w-full max-w-md flex-1 flex-col gap-3">
      <div class="grid grid-cols-[1fr_auto_1fr] items-center text-sm">
        <span class="flex items-center gap-1.5 justify-self-start font-medium text-stone-700 dark:text-stone-200">
          <IconStone seat="black" class="size-3.5" />
          你执黑
          <template v-if="!playing">
            ·
            <span class="font-semibold" :class="result.textCls">{{ result.char }}</span>
          </template>
        </span>
        <span class="flex items-center gap-1.5 rounded-full bg-white/70 px-3 py-0.5 text-xs text-stone-500 dark:bg-stone-800/70 dark:text-stone-400">
          <IconHome class="size-3.5" />
          AI · {{ DIFFICULTY_LABELS[difficulty] }}
        </span>
        <button
          class="flex cursor-pointer items-center gap-1 justify-self-end font-medium text-stone-500 transition-colors hover:text-stone-700 active:text-stone-700 dark:text-stone-400 dark:hover:text-stone-200 dark:active:text-stone-200"
          @click="showRules = true"
        >
          {{ CHALLENGE_TITLE }}
          <IconHelp class="size-4" />
        </button>
      </div>

      <div class="grid grid-cols-[1fr_auto_1fr] items-center text-sm">
        <span class="justify-self-start font-medium text-stone-700 dark:text-stone-200">第 {{ displayFrame }} 回合</span>
        <span class="flex items-center gap-1.5" :class="aiStatus.cls">
          <span class="size-2 rounded-full" :class="aiStatus.dot" />
          {{ aiStatus.text }}
        </span>
        <FrameTimer
          :frame-seconds="frameSeconds"
          :seconds-left="secondsLeft"
          :elapsed-seconds="elapsedSeconds"
          :urgency="urgency"
        />
      </div>

      <div class="relative w-full">
        <Board
          :state="reviewState ?? game"
          seat="black"
          :selected="reviewState ? null : selected"
          :submitted="resolving"
          :last-moves="reviewState ? reviewState.lastMoves : lastMoves"
          :vanishing="reviewState ? reviewState.cleared : vanishing"
          :interactive="playing && !resolving"
          @select="select"
        />
        <ResultOverlay
          v-if="!playing && !overlayDismissed"
          :char="result.char"
          :colors="result.colors"
          @dismiss="overlayDismissed = true"
        />
      </div>

      <template v-if="playing">
        <AppButton
          class="w-full"
          :disabled="!resolving && !selected"
          @click="resolving ? cancelChoice() : submitChoice()"
        >
          {{ resolving ? '取消提交' : selected ? '确认提交' : '点击棋盘选择落点' }}
        </AppButton>
      </template>
      <template v-else>
        <AppButton
          v-if="verdict === 'success' && nextDifficulty"
          class="w-full"
          @click="restart(nextDifficulty)"
        >
          挑战下一难度 · {{ DIFFICULTY_LABELS[nextDifficulty] }}
        </AppButton>
        <AppButton class="w-full" :secondary="verdict === 'success' && !!nextDifficulty" @click="restart()">
          再试一次
        </AppButton>
        <div v-if="reviewAvailable" class="flex w-full gap-2">
          <AppButton secondary class="flex-1" :disabled="reviewAtFirst" @click="review(-1)">
            上一回合
          </AppButton>
          <AppButton secondary class="flex-1" :disabled="reviewAtLatest" @click="review(1)">
            下一回合
          </AppButton>
        </div>
      </template>

      <div class="mt-auto flex items-center justify-center">
        <button
          class="cursor-pointer p-1 text-xs font-medium text-stone-400 transition-colors hover:text-stone-600 active:text-stone-600 dark:text-stone-500 dark:hover:text-stone-300 dark:active:text-stone-300"
          @click="backOrReplace()"
        >
          返回首页
        </button>
      </div>
    </div>

    <AppDialog v-if="showRules" :title="CHALLENGE_TITLE" @close="showRules = false">
      <ul class="flex flex-col gap-1.5 text-sm text-stone-500 dark:text-stone-400">
        <li v-for="item in RULES" :key="item" class="flex gap-2">
          <span class="text-stone-300 dark:text-stone-600">•</span>
          <span>{{ item }}</span>
        </li>
      </ul>
      <template #footer>
        <div class="flex">
          <DialogButton @click="showRules = false">知道了</DialogButton>
        </div>
      </template>
    </AppDialog>
  </main>
</template>
