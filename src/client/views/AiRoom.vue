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
import { type Difficulty } from '@/engine/ai'
import {
  createGame,
  isLegalChoice,
  settleFrame,
  type ClearedGroup,
  type GameMode,
  type GameState,
  type Point,
} from '@/engine/game'
import { useAiOpponent } from '~/composables/useAiOpponent'
import { useFrameClock } from '~/composables/useFrameClock'
import { useGameResult } from '~/composables/useGameResult'
import { DEFAULT_HELL_STRENGTH, DIFFICULTY_LABELS, DIFFICULTY_OPTIONS, MODE_LABELS } from '~/constants/branding'
import { AI_FRAME_START_KEY, AI_GAME_KEY } from '~/constants/storage'
import { AI_MODE_OPTIONS } from '@/shared/protocol'

const params = new URLSearchParams(location.search)
const rawMode = params.get('mode') as GameMode
const rawLevel = params.get('level') as Difficulty

const mode = ref<GameMode>(AI_MODE_OPTIONS.includes(rawMode) ? rawMode : 'forbidden')
// 人机对战恒不限时（无回合计时，仅正计时 Ns/∞）。
const frameSeconds = 0
const difficulty = ref<Difficulty>(DIFFICULTY_OPTIONS.includes(rawLevel) ? rawLevel : 'normal')

// strength 是「加成」滑条（只对地狱难度生效），取 URL 参数，非法则回落到默认；范围 0.05~1、步长 0.05。
// 引擎读心置信度 read = strength - 0.05：滑条 5%~100% → 置信 0~0.95（AI 本就有自然命中率，0 即纯盲搜、不再额外削弱）。
function clampStrength(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_HELL_STRENGTH
  return Math.min(1, Math.max(0.05, Math.round(raw * 20) / 20))
}
const strength = ref(clampStrength(Number(params.get('strength'))))
const engineRead = computed(() => Math.max(0, strength.value - 0.05))

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
const overlayDismissed = ref(false)
const showRules = ref(false)
const confirmingExit = ref(false)
const deadline = ref<number | null>(null)
const frameStart = ref<number | null>(null)
const resolving = ref(false)

const ai = useAiOpponent()
let pendingAiMove: Promise<Point | null> | null = null
let pendingResponse: Promise<Point | null> | null = null
let responseFor: Point | null = null
let responseTimer: ReturnType<typeof setTimeout> | undefined

const showConfig = ref(false)
const configMode = ref<GameMode>(mode.value)
const configDifficulty = ref<Difficulty>(difficulty.value)
const configStrength = ref(strength.value)

const responds = computed(() => difficulty.value === 'hell')
const difficultyPercent = computed(() => Math.round(strength.value * 100))
const showThinking = ref(false)
let thinkTimer: ReturnType<typeof setTimeout> | undefined
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
  if (resolving.value)
    return { text: '结算中…', dot: 'animate-pulse bg-stone-400', cls: 'text-stone-500 dark:text-stone-400' }
  if (ai.thinking.value || showThinking.value)
    return { text: 'AI 思考中', dot: 'bg-amber-400', cls: 'text-stone-500 dark:text-stone-400' }
  return { text: 'AI 已提交', dot: 'bg-emerald-500', cls: 'text-emerald-700 dark:text-emerald-400' }
})

// 本帧一开始就让 AI 在后台开算：AI 选点只依赖帧初局面、与人本帧隐藏选点无关，
// 故与人同时思考，结算时（await pendingAiMove）通常已备好，人零等待。
function beginFrame(startAt: number = Date.now()) {
  frameStart.value = startAt
  localStorage.setItem(AI_FRAME_START_KEY, String(startAt))
  clearTimeout(thinkTimer)
  clearTimeout(responseTimer)
  pendingResponse = null
  responseFor = null
  if (responds.value) {
    // 读心档：本帧手依赖人类落点，等 draft 后由 scheduleResponse 后台预算；无 draft 时结算兜底盲搜。
    pendingAiMove = null
    showThinking.value = true
    thinkTimer = setTimeout(() => (showThinking.value = false), 800 + Math.random() * 2200)
  } else {
    pendingAiMove = ai.request(game.value, 'white', difficulty.value)
  }
}

async function resolveFrame() {
  if (resolving.value || !playing.value) return
  resolving.value = true
  clearTimeout(thinkTimer)
  clearTimeout(responseTimer)
  showThinking.value = false
  const draft = selected.value
  const ready =
    draft && responseFor && responseFor.x === draft.x && responseFor.y === draft.y
      ? pendingResponse
      : null
  const aiMove =
    responds.value && draft
      ? await (ready ?? ai.request(game.value, 'white', difficulty.value, draft, false, engineRead.value))
      : await (pendingAiMove ?? ai.request(game.value, 'white', difficulty.value))
  const next = settleFrame(game.value, {
    black: selected.value,
    white: aiMove,
    first: Math.random() < 0.5 ? 'black' : 'white',
  })
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
  if (responds.value) scheduleResponse(point)
}

// 选点稳定后即在后台预算，提交时多半已就绪、零等待；改点则重排（旧结果作废）。
function scheduleResponse(point: Point) {
  if (responseFor && responseFor.x === point.x && responseFor.y === point.y) return
  responseFor = point
  pendingResponse = null
  clearTimeout(responseTimer)
  const target = point
  responseTimer = setTimeout(() => {
    pendingResponse = ai.request(game.value, 'white', difficulty.value, target, true, engineRead.value)
  }, 200)
}

function submitChoice() {
  if (!playing.value || !selected.value || resolving.value) return
  resolveFrame()
}

function restart() {
  game.value = createGame(mode.value)
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
  location.assign('/')
}

function openConfig() {
  configMode.value = mode.value
  configDifficulty.value = difficulty.value
  configStrength.value = strength.value
  showConfig.value = true
}

function confirmConfig() {
  showConfig.value = false
  mode.value = configMode.value
  difficulty.value = configDifficulty.value
  strength.value = configStrength.value
  history.replaceState(null, '', `/ai?mode=${mode.value}&level=${difficulty.value}&strength=${strength.value}`)
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
          AI · {{ DIFFICULTY_LABELS[difficulty] }}<template v-if="responds"> · {{ difficultyPercent }}%</template>
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
        <span class="justify-self-start font-medium text-stone-700 dark:text-stone-200">第 {{ game.frame }} 回合</span>
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
          :state="game"
          seat="black"
          :selected="selected"
          :submitted="false"
          :last-moves="lastMoves"
          :vanishing="vanishing"
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
        <AppButton class="w-full" :disabled="!selected || resolving" @click="submitChoice">
          {{ resolving ? 'AI 结算中…' : selected ? '确认提交' : '点击棋盘选择落点' }}
        </AppButton>
      </template>
      <template v-else>
        <AppButton class="w-full" @click="openConfig">再来一局</AppButton>
      </template>
    </div>

    <GameConfigDialog
      v-if="showConfig"
      v-model:mode="configMode"
      v-model:difficulty="configDifficulty"
      v-model:strength="configStrength"
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
