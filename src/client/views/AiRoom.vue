<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import AppButton from '~/components/AppButton.vue'
import Board from '~/components/Board.vue'
import FrameBar from '~/components/FrameBar.vue'
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
  type Point,
} from '@/engine/game'
import { useAiOpponent } from '~/composables/useAiOpponent'
import { useFrameClock } from '~/composables/useFrameClock'
import { useGameResult } from '~/composables/useGameResult'
import { DIFFICULTY_OPTIONS, MODE_LABELS } from '~/constants/branding'
import { AI_MODE_OPTIONS, FRAME_OPTIONS } from '@/shared/protocol'

const params = new URLSearchParams(location.search)
const rawMode = params.get('mode') as GameMode
const rawFrame = Number(params.get('frame'))
const rawLevel = params.get('level') as Difficulty

const mode = ref<GameMode>(AI_MODE_OPTIONS.includes(rawMode) ? rawMode : 'forbidden')
const frameSeconds = ref(FRAME_OPTIONS.includes(rawFrame) ? rawFrame : 0)
const difficulty = ref<Difficulty>(DIFFICULTY_OPTIONS.includes(rawLevel) ? rawLevel : 'normal')

const game = ref(createGame(mode.value))
const selected = ref<Point | null>(null)
const lastMoves = ref<Point[]>([])
const vanishing = ref<ClearedGroup[]>([])
const overlayDismissed = ref(false)
const showRules = ref(false)
const deadline = ref<number | null>(null)
const frameStart = ref<number | null>(null)
const resolving = ref(false)

const ai = useAiOpponent()
let pendingAiMove: Promise<Point | null> | null = null

const showConfig = ref(false)
const configFrame = ref(frameSeconds.value)
const configMode = ref<GameMode>(mode.value)
const configDifficulty = ref<Difficulty>(difficulty.value)

const playing = computed(() => game.value.phase === 'playing')
const { secondsLeft, remainingRatio, urgency, elapsedSeconds } = useFrameClock(
  deadline,
  frameSeconds,
  frameStart,
  playing,
)

const aiStatus = computed(() => {
  if (!playing.value) return null
  if (resolving.value)
    return { text: '结算中…', dot: 'animate-pulse bg-stone-400', cls: 'text-stone-500 dark:text-stone-400' }
  if (ai.thinking.value)
    return { text: 'AI 思考中', dot: 'bg-amber-400', cls: 'text-stone-500 dark:text-stone-400' }
  return { text: 'AI 已提交', dot: 'bg-emerald-500', cls: 'text-emerald-700 dark:text-emerald-400' }
})

// 本帧一开始就让 AI 在后台开算：AI 选点只依赖帧初局面、与人本帧隐藏选点无关，
// 故与人同时思考，结算时（await pendingAiMove）通常已备好，人零等待。
function beginFrame() {
  deadline.value = frameSeconds.value > 0 ? Date.now() + frameSeconds.value * 1000 : null
  frameStart.value = Date.now()
  pendingAiMove = ai.request(game.value, 'white', difficulty.value)
}

async function resolveFrame() {
  if (resolving.value || !playing.value) return
  resolving.value = true
  const aiMove = await (pendingAiMove ?? ai.request(game.value, 'white', difficulty.value))
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
  else deadline.value = null
}

function select(point: Point) {
  if (!playing.value || resolving.value || !isLegalChoice(game.value, point)) return
  selected.value = point
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

function openConfig() {
  configFrame.value = frameSeconds.value
  configMode.value = mode.value
  configDifficulty.value = difficulty.value
  showConfig.value = true
}

function confirmConfig() {
  showConfig.value = false
  frameSeconds.value = configFrame.value
  mode.value = configMode.value
  difficulty.value = configDifficulty.value
  history.replaceState(
    null,
    '',
    `/ai?mode=${mode.value}&frame=${frameSeconds.value}&level=${difficulty.value}`,
  )
  restart()
}

watch(secondsLeft, (value) => {
  if (value === 0 && playing.value) resolveFrame()
})

onMounted(beginFrame)

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
          人机对战
          <a class="cursor-pointer text-red-400 transition-colors hover:text-red-600" aria-label="退出对局" href="/">
            <IconLogout class="size-3.5" />
          </a>
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
        <span v-if="aiStatus" class="flex items-center gap-1.5" :class="aiStatus.cls">
          <span class="size-2 rounded-full" :class="aiStatus.dot" />
          {{ aiStatus.text }}
        </span>
        <span v-else />
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
      v-model:frame="configFrame"
      v-model:mode="configMode"
      v-model:difficulty="configDifficulty"
      :mode-options="AI_MODE_OPTIONS"
      :difficulties="DIFFICULTY_OPTIONS"
      title="人机对战"
      confirm-text="开始对战"
      @cancel="showConfig = false"
      @confirm="confirmConfig"
    />

    <RulesDialog v-if="showRules" @close="showRules = false" />
  </main>
</template>
