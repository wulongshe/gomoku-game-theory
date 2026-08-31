<script setup lang="ts">
import { computed, ref } from 'vue'
import Board from '@/components/Board.vue'
import { aiMove } from '@/game/ai'
import {
  DEFAULT_HELL_STRENGTH,
  DIFFICULTY_LABELS,
  DIFFICULTY_OPTIONS,
  MODE_LABELS,
  MODE_OPTIONS,
} from '@/game/constants'
import { loadGame, saveGame } from '@/game/storage'
import type { Difficulty } from '@gomoku/engine/ai'
import { createGame, isLegalChoice, settleFrame, type GameMode, type Point } from '@gomoku/engine/game'

const mode = ref<GameMode>('forbidden')
const difficulty = ref<Difficulty>('normal')

// 棋力滑条只对地狱难度生效；引擎读心置信度 read = 棋力 - 0.05（5% 即纯盲搜）。
const strength = ref(DEFAULT_HELL_STRENGTH)
const strengthPercent = ref(Math.round(strength.value * 100))
const engineRead = computed(() => Math.max(0, strength.value - 0.05))

const game = ref(loadGame(mode.value) ?? createGame(mode.value))
const selected = ref<Point | null>(null)
const thinking = ref(false)
const resolving = ref(false)

const playing = computed(() => game.value.phase === 'playing')
const isHell = computed(() => difficulty.value === 'hell')

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

const statusText = computed(() => {
  if (!playing.value) return '对局结束'
  if (resolving.value || thinking.value) return 'AI 思考中'
  return selected.value ? '待提交' : '请落子'
})
const statusClass = computed(() => {
  if (!playing.value) return 'dot-off'
  if (resolving.value || thinking.value) return 'dot-think'
  return 'dot-ready'
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
  thinking.value = true
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
  thinking.value = false
  resolving.value = false
  saveGame(next)
}

function restart(): void {
  game.value = createGame(mode.value)
  selected.value = null
  resolving.value = false
  thinking.value = false
  saveGame(game.value)
}

function pickDifficulty(d: Difficulty): void {
  if (d === difficulty.value) return
  difficulty.value = d
  restart()
}

function pickMode(m: GameMode): void {
  if (m === mode.value) return
  mode.value = m
  restart()
}

type SliderEvent = { detail: { value: number } }
function onStrengthChanging(e: SliderEvent): void {
  strengthPercent.value = e.detail.value
}
function onStrengthChange(e: SliderEvent): void {
  strengthPercent.value = e.detail.value
  strength.value = e.detail.value / 100
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
      <text class="mode">{{ MODE_LABELS[mode] }}模式</text>
    </view>

    <view class="status">
      <text>第 {{ game.frame }} 回合</text>
      <text class="dot" :class="statusClass">{{ statusText }}</text>
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
        {{ resolving ? 'AI 结算中…' : selected ? '确认提交' : '点击棋盘选择落点' }}
      </view>
    </view>
    <view v-else class="actions">
      <text class="result">{{ result }}</text>
      <view class="btn btn-primary" @tap="restart">再来一局</view>
    </view>

    <view class="picker">
      <text class="picker-label">难度</text>
      <view class="chips">
        <view
          v-for="d in DIFFICULTY_OPTIONS"
          :key="d"
          class="chip"
          :class="{ 'chip-on': d === difficulty }"
          @tap="pickDifficulty(d)"
        >
          {{ DIFFICULTY_LABELS[d] }}
        </view>
      </view>
    </view>

    <view v-if="isHell" class="picker">
      <text class="picker-label">棋力</text>
      <slider
        class="slider"
        :min="5"
        :max="100"
        :step="5"
        :value="strengthPercent"
        active-color="#1c1917"
        block-size="20"
        @changing="onStrengthChanging"
        @change="onStrengthChange"
      />
      <text class="picker-val">{{ strengthPercent }}%</text>
    </view>

    <view class="picker">
      <text class="picker-label">模式</text>
      <view class="chips">
        <view
          v-for="m in MODE_OPTIONS"
          :key="m"
          class="chip"
          :class="{ 'chip-on': m === mode }"
          @tap="pickMode(m)"
        >
          {{ MODE_LABELS[m] }}
        </view>
      </view>
    </view>
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
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 26rpx;
  color: #57534e;
}
.dot-think {
  color: #b45309;
}
.dot-ready {
  color: #047857;
}
.dot-off {
  color: #78716c;
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
.btn {
  width: 100%;
  text-align: center;
  padding: 24rpx 0;
  border-radius: 16rpx;
  font-size: 30rpx;
}
.btn-primary {
  background: #1c1917;
  color: #fafaf9;
}
.btn-disabled {
  background: #d6d3d1;
  color: #a8a29e;
}
.picker {
  width: 690rpx;
  display: flex;
  align-items: center;
  gap: 16rpx;
  font-size: 26rpx;
}
.picker-label {
  color: #78716c;
  width: 80rpx;
}
.slider {
  flex: 1;
  margin: 0;
}
.picker-val {
  width: 72rpx;
  text-align: right;
  color: #292524;
}
.chips {
  display: flex;
  gap: 12rpx;
  flex-wrap: wrap;
}
.chip {
  padding: 10rpx 24rpx;
  border-radius: 999rpx;
  background: #ffffff;
  color: #57534e;
  border: 1px solid #e7e5e4;
}
.chip-on {
  background: #1c1917;
  color: #fafaf9;
  border-color: #1c1917;
}
</style>
