<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import AppButton from '~/components/AppButton.vue'
import AppDialog from '~/components/AppDialog.vue'
import Board from '~/components/Board.vue'
import DialogButton from '~/components/DialogButton.vue'
import FrameTimer from '~/components/FrameTimer.vue'
import GameConfigDialog from '~/components/GameConfigDialog.vue'
import ResultOverlay from '~/components/ResultOverlay.vue'
import RulesDialog from '~/components/RulesDialog.vue'
import IconHelp from '~/components/icons/IconHelp.vue'
import IconHome from '~/components/icons/IconHome.vue'
import IconLogout from '~/components/icons/IconLogout.vue'
import IconStone from '~/components/icons/IconStone.vue'
import { type Difficulty } from '@gomoku/engine/ai'
import {
  createGame,
  isLegalChoice,
  settleFrame,
  type ClearedGroup,
  type GameMode,
  type GameState,
  type Point,
} from '@gomoku/engine/game'
import { useAiOpponent } from '~/composables/useAiOpponent'
import { useFrameClock } from '~/composables/useFrameClock'
import { useGameReview } from '~/composables/useGameReview'
import { useGameResult } from '~/composables/useGameResult'
import { DIFFICULTY_LABELS, MODE_LABELS } from '@gomoku/branding'
import { AI_MODE_OPTIONS, DIFFICULTY_OPTIONS } from '@gomoku/config'
import { AI_FRAME_START_KEY, AI_GAME_KEY, AI_MOVES_KEY } from '~/constants/storage'
import { backOrReplace } from '~/utils/navigation'
import type { FrameMoves } from '@/shared/protocol'

const params = new URLSearchParams(location.search)
const rawMode = params.get('mode') as GameMode
const rawDifficulty = params.get('difficulty') as Difficulty

const mode = ref<GameMode>(AI_MODE_OPTIONS.includes(rawMode) ? rawMode : 'forbidden')
// 人机对战恒不限时（无回合计时，仅正计时 Ns/∞）。
const frameSeconds = 0
const difficulty = ref<Difficulty>(
  DIFFICULTY_OPTIONS.includes(rawDifficulty) ? rawDifficulty : 'normal',
)

// 本地对局持久化：仅「刷新」续上存档（且模式一致）；从首页/直接进入（navigate）一律重开，即使配置相同。
function loadSavedGame(): GameState | null {
  try {
    const saved = JSON.parse(localStorage.getItem(AI_GAME_KEY) ?? 'null') as GameState | null
    return saved && saved.mode === mode.value ? saved : null
  } catch {
    return null
  }
}
const reloaded =
  (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined)?.type ===
  'reload'
const savedGame = reloaded ? loadSavedGame() : null
const game = ref<GameState>(savedGame ?? createGame(mode.value))
watch(game, (g) => localStorage.setItem(AI_GAME_KEY, JSON.stringify(g)), { immediate: true })
// 刷新续局时一并续上本回合正计时起点，避免归零。
const savedFrameStart = savedGame ? Number(localStorage.getItem(AI_FRAME_START_KEY)) || null : null

const selected = ref<Point | null>(null)
const lastMoves = ref<Point[]>(savedGame?.lastMoves ?? [])
const vanishing = ref<ClearedGroup[]>([])
const {
  state: reviewState,
  atFirst: reviewAtFirst,
  atLatest: reviewAtLatest,
  available: reviewAvailable,
  record: recordFrame,
  reset: resetReview,
  step: stepReview,
} = useGameReview()

// 全帧落点随局持久化；刷新续局时用引擎重放复原复盘历史（与存档局面对不上就放弃）。
let movesLog: FrameMoves[] = []
if (savedGame) {
  try {
    const saved = JSON.parse(localStorage.getItem(AI_MOVES_KEY) ?? '[]') as FrameMoves[]
    let replayed = createGame(savedGame.mode)
    for (const [black, white, first] of saved) {
      replayed = settleFrame(replayed, { black, white, first })
      recordFrame(replayed)
    }
    if (replayed.frame === savedGame.frame) movesLog = saved
    else resetReview()
  } catch {
    resetReview()
  }
}

function logMove(entry: FrameMoves) {
  movesLog.push(entry)
  localStorage.setItem(AI_MOVES_KEY, JSON.stringify(movesLog))
}
const overlayDismissed = ref(false)
const showRules = ref(false)
const confirmingExit = ref(false)
const deadline = ref<number | null>(null)
const frameStart = ref<number | null>(null)
const resolving = ref(false)

const ai = useAiOpponent()
let pendingAiMove: Promise<Point | null> | null = null

const showConfig = ref(false)
const configMode = ref<GameMode>(mode.value)
const configDifficulty = ref<Difficulty>(difficulty.value)

const playing = computed(() => game.value.phase === 'playing')
const { secondsLeft, urgency, elapsedSeconds } = useFrameClock(
  deadline,
  frameSeconds,
  frameStart,
  playing,
)

const aiStatus = computed(() => {
  if (!playing.value)
    return { text: '对局结束', dot: 'bg-stone-400', cls: 'text-stone-500 dark:text-stone-400' }
  if (ai.thinking.value)
    return { text: 'AI 思考中', dot: 'bg-amber-400', cls: 'text-stone-500 dark:text-stone-400' }
  return { text: 'AI 已提交', dot: 'bg-emerald-500', cls: 'text-emerald-700 dark:text-emerald-400' }
})

// 本帧一开始就让 AI 在后台开算：AI 选点只依赖帧初局面、与人本帧隐藏选点无关，
// 故与人同时思考，结算时（await pendingAiMove）通常已备好，人零等待。
function beginFrame(startAt: number = Date.now()) {
  frameStart.value = startAt
  localStorage.setItem(AI_FRAME_START_KEY, String(startAt))
  pendingAiMove = ai.request(game.value, 'white', difficulty.value)
}

// AI 未出手期间可撤回提交；撤回后本次结算作废，selected 保留可改点重交。
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
  const first = Math.random() < 0.5 ? 'black' : 'white'
  const next = settleFrame(game.value, { black: selected.value, white: aiMove, first })
  logMove([selected.value, aiMove, first])
  recordFrame(next)
  lastMoves.value = next.lastMoves
  vanishing.value = next.cleared
  game.value = next
  selected.value = null
  pendingAiMove = null
  resolving.value = false
  if (next.phase === 'playing') beginFrame()
}

function select(point: Point) {
  if (!playing.value || resolving.value || !isLegalChoice(game.value, point)) return
  selected.value = point
}

function submitChoice() {
  if (!playing.value || !selected.value || resolving.value) return
  resolveFrame()
}

// 翻回合时顺带收起结果遮罩，露出棋盘。
function review(delta: number) {
  overlayDismissed.value = true
  stepReview(delta)
}

// 对局中 frame 表示「正在下第 N 回合」；回放与终局态按已下完的回合数显示（引擎 +1 过）。
const displayFrame = computed(() => {
  const state = reviewState.value ?? game.value
  return state.phase === 'playing' && !reviewState.value ? state.frame : state.frame - 1
})

function restart() {
  game.value = createGame(mode.value)
  resetReview()
  movesLog = []
  localStorage.removeItem(AI_MOVES_KEY)
  selected.value = null
  lastMoves.value = []
  vanishing.value = []
  overlayDismissed.value = false
  pendingAiMove = null
  resolving.value = false
  beginFrame()
}

// 明确退出人机对战：清空本地存档，避免下次进入又续上已放弃的对局。
function exitRoom() {
  localStorage.removeItem(AI_GAME_KEY)
  localStorage.removeItem(AI_FRAME_START_KEY)
  localStorage.removeItem(AI_MOVES_KEY)
  backOrReplace()
}

function openConfig() {
  configMode.value = mode.value
  configDifficulty.value = difficulty.value
  showConfig.value = true
}

function confirmConfig() {
  showConfig.value = false
  mode.value = configMode.value
  difficulty.value = configDifficulty.value
  history.replaceState(null, '', `/ai?mode=${mode.value}&difficulty=${difficulty.value}`)
  restart()
}

onMounted(() => {
  if (playing.value) beginFrame(savedFrameStart ?? Date.now())
})

const { char: resultChar, colors: resultColors, textCls: resultTextCls } = useGameResult(
  () => game.value,
  'black',
)
</script>

<template>
  <main
    class="flex min-h-dvh flex-col items-center bg-gradient-to-b from-stone-100 to-stone-200 p-4 dark:from-stone-900 dark:to-stone-950"
  >
    <div class="flex w-full max-w-md flex-1 flex-col justify-center gap-3">
      <div class="grid grid-cols-[1fr_auto_1fr] items-center text-sm">
        <span class="flex items-center gap-1.5 justify-self-start font-medium text-stone-700 dark:text-stone-200">
          <IconStone seat="black" class="size-3.5" />
          你执黑
          <template v-if="!playing">
            ·
            <span class="font-semibold" :class="resultTextCls">{{ resultChar }}</span>
          </template>
        </span>
        <span class="flex items-center gap-1.5 rounded-full bg-white/70 px-3 py-0.5 text-xs text-stone-500 dark:bg-stone-800/70 dark:text-stone-400">
          <IconHome class="size-3.5" />
          AI · {{ DIFFICULTY_LABELS[difficulty] }}
          <button
            class="cursor-pointer text-red-400 transition-colors hover:text-red-600"
            aria-label="退出对局"
            @click="confirmingExit = true"
          >
            <IconLogout class="size-3.5" />
          </button>
        </span>
        <button
          class="flex cursor-pointer items-center gap-1 justify-self-end font-medium text-stone-500 transition-colors hover:text-stone-700 active:text-stone-700 dark:text-stone-400 dark:hover:text-stone-200 dark:active:text-stone-200"
          @click="showRules = true"
        >
          {{ MODE_LABELS[game.mode] }}模式
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
          :submitted="false"
          :last-moves="reviewState ? reviewState.lastMoves : lastMoves"
          :vanishing="reviewState ? [] : vanishing"
          :interactive="playing && !resolving"
          @select="select"
        />
        <ResultOverlay
          v-if="!playing && !overlayDismissed"
          :char="resultChar"
          :colors="resultColors"
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
        <AppButton class="w-full" @click="openConfig">再来一局</AppButton>
        <div v-if="reviewAvailable" class="flex w-full gap-2">
          <AppButton secondary class="flex-1" :disabled="reviewAtFirst" @click="review(-1)">
            上一回合
          </AppButton>
          <AppButton secondary class="flex-1" :disabled="reviewAtLatest" @click="review(1)">
            下一回合
          </AppButton>
        </div>
      </template>
    </div>

    <GameConfigDialog
      v-if="showConfig"
      v-model:mode="configMode"
      v-model:difficulty="configDifficulty"
      :show-frame="false"
      :mode-options="AI_MODE_OPTIONS"
      :difficulties="DIFFICULTY_OPTIONS"
      title="人机对战"
      confirm-text="开始对战"
      @cancel="showConfig = false"
      @confirm="confirmConfig"
    />

    <RulesDialog v-if="showRules" @close="showRules = false" />

    <AppDialog v-if="confirmingExit" title="退出人机对战？" :closable="false">
      <p class="text-sm text-stone-500 dark:text-stone-400">退出后本局将清空，无法继续。</p>
      <template #footer>
        <div class="flex gap-2">
          <DialogButton variant="secondary" @click="confirmingExit = false">取消</DialogButton>
          <DialogButton variant="danger" @click="exitRoom">退出</DialogButton>
        </div>
      </template>
    </AppDialog>
  </main>
</template>
