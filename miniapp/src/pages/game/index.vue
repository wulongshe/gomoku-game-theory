<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue'
import Taro, { useShareAppMessage } from '@tarojs/taro'
import Board from '@/components/Board.vue'
import ConfigDialog, { type GameConfig } from '@/components/ConfigDialog.vue'
import RulesDialog from '@/components/RulesDialog.vue'
import { aiMove } from '@/game/ai'
import {
  AI_MODE_OPTIONS,
  DEFAULT_HELL_STRENGTH,
  DIFFICULTY_LABELS,
  DIFFICULTY_OPTIONS,
  MODE_LABELS,
} from '@gomoku/branding'
import type { Difficulty } from '@gomoku/engine/ai'
import { createGame, isLegalChoice, settleFrame, type GameMode, type Point } from '@gomoku/engine/game'

const params = Taro.getCurrentInstance().router?.params ?? {}
const rawMode = params.mode as GameMode
const rawLevel = params.level as Difficulty

const mode = ref<GameMode>(AI_MODE_OPTIONS.includes(rawMode) ? rawMode : 'forbidden')
const difficulty = ref<Difficulty>(DIFFICULTY_OPTIONS.includes(rawLevel) ? rawLevel : 'normal')

// strength 是「棋力」滑条（只对地狱难度生效），非法则回落默认；范围 0.05~1、步长 0.05。
// 引擎读心置信度 read = 棋力 - 0.05（5% 即纯盲搜）。
function clampStrength(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_HELL_STRENGTH
  return Math.min(1, Math.max(0.05, Math.round(raw * 20) / 20))
}
const strength = ref(clampStrength(Number(params.strength)))
const engineRead = computed(() => Math.max(0, strength.value - 0.05))

// 分享当前配置，接收方直达同难度对局。
useShareAppMessage(() => ({
  title: `敢来挑战${DIFFICULTY_LABELS[difficulty.value]} AI 吗？｜博弈五子棋`,
  path: `/pages/game/index?mode=${mode.value}&level=${difficulty.value}&strength=${strength.value}`,
}))

// 每次进入对战页都是新对局；退出即弃，避免换难度后还续上一局。
const game = ref(createGame(mode.value))
const selected = ref<Point | null>(null)
const resolving = ref(false)
const showRules = ref(false)
const showConfig = ref(false)

const playing = computed(() => game.value.phase === 'playing')
const isHell = computed(() => difficulty.value === 'hell')
const strengthPercent = computed(() => Math.round(strength.value * 100))

// 帧正计时（人机恒不限时，Ns/∞），随每帧重置。
const now = ref(Date.now())
const frameStart = ref(Date.now())
const clock = setInterval(() => (now.value = Date.now()), 250)
const elapsedSeconds = computed(() =>
  playing.value ? Math.max(0, Math.floor((now.value - frameStart.value) / 1000)) : 0,
)

// AI 实际在提交时才结算，这里按帧初起一段随机「思考」窗口，与 web 端观感一致。
const showThinking = ref(false)
let thinkTimer: ReturnType<typeof setTimeout> | undefined

function beginFrame(): void {
  frameStart.value = Date.now()
  clearTimeout(thinkTimer)
  showThinking.value = true
  thinkTimer = setTimeout(() => (showThinking.value = false), 800 + Math.random() * 2200)
}
beginFrame()

onUnmounted(() => {
  clearInterval(clock)
  clearTimeout(thinkTimer)
})

const result = computed(() => {
  switch (game.value.phase) {
    case 'black_won':
      return '你赢了'
    case 'white_won':
      return 'AI 获胜'
    case 'draw':
      return '和棋'
    default:
      return ''
  }
})

const aiStatus = computed(() => {
  if (!playing.value) return { text: '对局结束', dot: 'dot-idle', cls: 'st-muted' }
  if (resolving.value) return { text: '结算中…', dot: 'dot-idle dot-pulse', cls: 'st-muted' }
  if (showThinking.value) return { text: 'AI 思考中', dot: 'dot-think', cls: 'st-muted' }
  return { text: 'AI 已提交', dot: 'dot-ready', cls: 'st-ready' }
})

function onSelect(point: Point): void {
  if (!playing.value || resolving.value || !isLegalChoice(game.value, point)) return
  selected.value = point
}

function nextTickPaint(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 24))
}

async function submit(): Promise<void> {
  if (!playing.value || !selected.value || resolving.value) return
  resolving.value = true
  clearTimeout(thinkTimer)
  showThinking.value = false
  await nextTickPaint()
  const white = aiMove(
    game.value,
    difficulty.value,
    isHell.value ? selected.value : null,
    isHell.value ? engineRead.value : 0,
  )
  const next = settleFrame(game.value, {
    black: selected.value,
    white,
    first: Math.random() < 0.5 ? 'black' : 'white',
  })
  game.value = next
  selected.value = null
  resolving.value = false
  if (next.phase === 'playing') beginFrame()
}

function restart(): void {
  game.value = createGame(mode.value)
  selected.value = null
  resolving.value = false
  beginFrame()
}

function applyConfig(config: GameConfig): void {
  showConfig.value = false
  mode.value = config.mode
  difficulty.value = config.difficulty
  strength.value = config.strength
  restart()
}
</script>

<template>
  <view class="page">
    <view class="head">
      <view class="seat">
        <view class="mini-stone" />
        <text>你执黑</text>
      </view>
      <text class="vs">
        AI · {{ DIFFICULTY_LABELS[difficulty]
        }}<text v-if="isHell"> · {{ strengthPercent }}%</text>
      </text>
      <text class="mode" @tap="showRules = true">{{ MODE_LABELS[mode] }}模式 ?</text>
    </view>

    <view class="status">
      <text class="frame">第 {{ game.frame }} 回合</text>
      <view class="ai-status" :class="aiStatus.cls">
        <view class="dot" :class="aiStatus.dot" />
        <text>{{ aiStatus.text }}</text>
      </view>
      <text class="timer">{{ elapsedSeconds }}s/<text class="inf">∞</text></text>
    </view>

    <Board
      :state="game"
      :selected="selected"
      :last-moves="game.lastMoves"
      :interactive="playing && !resolving"
      @select="onSelect"
    />

    <view v-if="playing" class="actions">
      <view
        class="btn btn-primary"
        :class="{ 'btn-disabled': !selected || resolving }"
        @tap="submit"
      >
        {{ resolving ? '结算中…' : selected ? '确认提交' : '点击棋盘选择落点' }}
      </view>
    </view>
    <view v-else class="actions">
      <text class="result">{{ result }}</text>
      <view class="btn btn-primary" @tap="showConfig = true">再来一局</view>
    </view>

    <RulesDialog v-if="showRules" @close="showRules = false" />

    <ConfigDialog
      v-if="showConfig"
      :mode="mode"
      :difficulty="difficulty"
      :strength="strength"
      @cancel="showConfig = false"
      @confirm="applyConfig"
    />
  </view>
</template>

<style>
.page {
  padding: 24rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 20rpx;
}
.head {
  width: 690rpx;
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 26rpx;
  color: #57534e;
}
.seat {
  display: flex;
  align-items: center;
  gap: 8rpx;
  color: #292524;
  font-weight: 600;
}
.mini-stone {
  width: 22rpx;
  height: 22rpx;
  border-radius: 50%;
  background: #1c1917;
}
.vs {
  background: rgba(255, 255, 255, 0.7);
  padding: 4rpx 16rpx;
  border-radius: 999rpx;
}
.mode {
  color: #78716c;
}
.status {
  width: 690rpx;
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  font-size: 26rpx;
}
.frame {
  justify-self: start;
  font-weight: 500;
  color: #44403c;
}
.ai-status {
  display: flex;
  align-items: center;
  gap: 10rpx;
}
.st-muted {
  color: #78716c;
}
.st-ready {
  color: #047857;
}
.dot {
  width: 14rpx;
  height: 14rpx;
  border-radius: 50%;
}
.dot-idle {
  background: #a8a29e;
}
.dot-think {
  background: #fbbf24;
}
.dot-ready {
  background: #10b981;
}
.dot-pulse {
  animation: dot-pulse 1.6s ease-in-out infinite;
}
@keyframes dot-pulse {
  50% {
    opacity: 0.4;
  }
}
.timer {
  justify-self: end;
  font-size: 30rpx;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: #57534e;
}
.inf {
  position: relative;
  top: 0.05em;
}
.actions {
  width: 690rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12rpx;
}
.result {
  font-size: 32rpx;
  font-weight: 700;
  color: #292524;
}
</style>
