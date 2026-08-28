<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useTimestamp } from '@vueuse/core'
import AppButton from '~/components/AppButton.vue'
import Board from '~/components/Board.vue'
import GameConfigDialog from '~/components/GameConfigDialog.vue'
import ResultOverlay from '~/components/ResultOverlay.vue'
import RulesDialog from '~/components/RulesDialog.vue'
import IconHelp from '~/components/icons/IconHelp.vue'
import IconHome from '~/components/icons/IconHome.vue'
import IconLogout from '~/components/icons/IconLogout.vue'
import IconStone from '~/components/icons/IconStone.vue'
import { chooseAiMove, type Difficulty } from '@/engine/ai'
import {
  createGame,
  isLegalChoice,
  settleFrame,
  type ClearedGroup,
  type GameMode,
  type Point,
} from '@/engine/game'
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

const showConfig = ref(false)
const configFrame = ref(frameSeconds.value)
const configMode = ref<GameMode>(mode.value)
const configDifficulty = ref<Difficulty>(difficulty.value)

const now = useTimestamp({ interval: 250 })
const playing = computed(() => game.value.phase === 'playing')

const secondsLeft = computed(() => {
  if (deadline.value === null) return null
  return Math.max(0, Math.ceil((deadline.value - now.value) / 1000))
})
const remainingRatio = computed(() => {
  if (deadline.value === null) return 0
  return Math.min(1, Math.max(0, (deadline.value - now.value) / (frameSeconds.value * 1000)))
})
const urgency = computed(() => {
  if (secondsLeft.value === null) return 'calm'
  if (secondsLeft.value <= 5) return 'critical'
  if (remainingRatio.value <= 1 / 3) return 'warning'
  return 'calm'
})

function startFrame() {
  deadline.value = frameSeconds.value > 0 ? Date.now() + frameSeconds.value * 1000 : null
}

function resolveFrame() {
  const next = settleFrame(game.value, {
    black: selected.value,
    white: chooseAiMove(game.value, 'white', difficulty.value),
    first: Math.random() < 0.5 ? 'black' : 'white',
  })
  lastMoves.value = next.lastMoves
  vanishing.value = next.cleared
  game.value = next
  selected.value = null
  if (next.phase === 'playing') startFrame()
  else deadline.value = null
}

function select(point: Point) {
  if (!playing.value || !isLegalChoice(game.value, point)) return
  selected.value = point
}

function submitChoice() {
  if (!playing.value || !selected.value) return
  resolveFrame()
}

function restart() {
  game.value = createGame(mode.value)
  selected.value = null
  lastMoves.value = []
  vanishing.value = []
  overlayDismissed.value = false
  startFrame()
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

onMounted(startFrame)

const resultChar = computed(() => {
  if (game.value.phase === 'draw') return '和'
  return game.value.phase === 'black_won' ? '赢' : '输'
})

const resultColors = computed(() => {
  if (game.value.phase === 'draw') return ['#ffffff', '#d6d3d1']
  return game.value.phase === 'black_won' ? ['#fbbf24', '#d97706'] : ['#a8a29e', '#57534e']
})

const resultTextCls = computed(() => {
  if (game.value.phase === 'draw') return 'text-white drop-shadow-[0_1px_1px_rgba(28,25,23,0.45)]'
  return game.value.phase === 'black_won'
    ? 'text-amber-500 dark:text-amber-400'
    : 'text-stone-400 dark:text-stone-500'
})
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

      <div class="grid grid-cols-[1fr_auto] items-center text-sm">
        <span class="justify-self-start font-medium text-stone-700 dark:text-stone-200">第 {{ game.frame }} 回合</span>
        <span
          v-if="frameSeconds > 0"
          class="justify-self-end text-base font-semibold tabular-nums"
          :class="{
            'text-stone-600 dark:text-stone-300': urgency === 'calm',
            'text-amber-600 dark:text-amber-400': urgency === 'warning',
            'animate-pulse text-red-600 dark:text-red-400': urgency === 'critical',
          }"
        >
          {{ secondsLeft ?? 0 }}s/{{ frameSeconds }}s
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
          :state="game"
          seat="black"
          :selected="selected"
          :submitted="false"
          :last-moves="lastMoves"
          :vanishing="vanishing"
          :interactive="playing"
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
        <AppButton class="w-full" :disabled="!selected" @click="submitChoice">
          {{ selected ? '确认提交' : '点击棋盘选择落点' }}
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
