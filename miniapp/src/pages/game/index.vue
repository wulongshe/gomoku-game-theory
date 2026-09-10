<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue'
import Taro, { useShareAppMessage } from '@tarojs/taro'
import Board from '@/components/Board.vue'
import ConfigDialog from '@/components/ConfigDialog.vue'
import RulesDialog from '@/components/RulesDialog.vue'
import { startAiMove, type AiJob } from '@/game/ai'
import { saveConfig, type GameConfig } from '@/game/config'
import { DIFFICULTY_LABELS, MODE_LABELS } from '@gomoku/branding'
import { AI_MODE_OPTIONS, DIFFICULTY_OPTIONS } from '@gomoku/config'
import type { Difficulty } from '@gomoku/engine/ai'
import {
  createGame,
  isLegalChoice,
  settleFrame,
  type GameMode,
  type GameState,
  type Point,
} from '@gomoku/engine/game'

const params = Taro.getCurrentInstance().router?.params ?? {}
const rawMode = params.mode as GameMode
const rawDifficulty = params.difficulty as Difficulty

const mode = ref<GameMode>(AI_MODE_OPTIONS.includes(rawMode) ? rawMode : 'forbidden')
const difficulty = ref<Difficulty>(
  DIFFICULTY_OPTIONS.includes(rawDifficulty) ? rawDifficulty : 'normal',
)

// 分享当前配置，接收方直达同难度对局。
useShareAppMessage(() => ({
  title: `敢来挑战${DIFFICULTY_LABELS[difficulty.value]} AI 吗？｜博弈五子棋`,
  path: `/pages/game/index?mode=${mode.value}&difficulty=${difficulty.value}`,
}))

// 每次进入对战页都是新对局；退出即弃，避免换难度后还续上一局。
const game = ref(createGame(mode.value))
const selected = ref<Point | null>(null)
const resolving = ref(false)
const showRules = ref(false)
const showConfig = ref(false)
const confirmingExit = ref(false)
const overlayDismissed = ref(false)

const playing = computed(() => game.value.phase === 'playing')

// 终局回看：缓存每个已结算回合的局面（不含开局空盘），结束后逐回合前后翻看；null = 停在最新一帧。
const history = ref<GameState[]>([])
const reviewIndex = ref<number | null>(null)
const reviewState = computed(() =>
  reviewIndex.value === null ? null : (history.value[reviewIndex.value] ?? null),
)
const reviewAtFirst = computed(() => (reviewIndex.value ?? history.value.length - 1) <= 0)
const reviewAtLatest = computed(() => reviewIndex.value === null)
const reviewAvailable = computed(() => history.value.length > 1)

// 翻回合时顺带收起结果遮罩，露出棋盘。
function review(delta: number): void {
  overlayDismissed.value = true
  const last = history.value.length - 1
  if (last < 0) return
  const next = Math.min(last, Math.max(0, (reviewIndex.value ?? last) + delta))
  reviewIndex.value = next === last ? null : next
}

const shown = computed(() => reviewState.value ?? game.value)
// 对局中 frame 表示「正在下第 N 回合」；回放与终局态按已下完的回合数显示（引擎 +1 过）。
const displayFrame = computed(() =>
  shown.value.phase === 'playing' && !reviewState.value ? shown.value.frame : shown.value.frame - 1,
)

// 帧正计时（人机恒不限时，Ns/∞），随每帧重置。
const now = ref(Date.now())
const frameStart = ref(Date.now())
const clock = setInterval(() => (now.value = Date.now()), 250)
const elapsedSeconds = computed(() =>
  playing.value ? Math.max(0, Math.floor((now.value - frameStart.value) / 1000)) : 0,
)

// 本帧一开始就让 AI 分片开算：AI 选点只依赖帧初局面、与人本帧隐藏选点无关，
// 故与人同时思考，提交时通常已备好，人零等待。
const aiThinking = ref(false)
let aiJob: AiJob | null = null

function beginFrame(): void {
  frameStart.value = Date.now()
  aiJob?.cancel()
  const job = startAiMove(game.value, difficulty.value)
  aiJob = job
  aiThinking.value = true
  job.move.then(() => {
    if (aiJob === job) aiThinking.value = false
  })
}
beginFrame()

onUnmounted(() => {
  clearInterval(clock)
  aiJob?.cancel()
})

const decided = computed(() => game.value.phase === 'black_won' || game.value.phase === 'white_won')
const won = computed(() => game.value.phase === 'black_won')
const resultChar = computed(() => (!decided.value ? '和' : won.value ? '赢' : '输'))
const resultCls = computed(() => (!decided.value ? 'res-draw' : won.value ? 'res-won' : 'res-lost'))

const aiStatus = computed(() => {
  if (!playing.value) return { text: '对局结束', dot: 'dot-idle', cls: 'st-muted' }
  if (aiThinking.value) return { text: 'AI 思考中', dot: 'dot-think', cls: 'st-muted' }
  return { text: 'AI 已提交', dot: 'dot-ready', cls: 'st-ready' }
})

function onSelect(point: Point): void {
  if (!playing.value || resolving.value || !isLegalChoice(game.value, point)) return
  selected.value = point
}

// AI 未出手期间可撤回提交；撤回后本次结算作废，selected 保留可改点重交。
let submitSeq = 0
function cancelChoice(): void {
  if (!resolving.value) return
  submitSeq++
  resolving.value = false
}

async function submit(): Promise<void> {
  if (!playing.value || !selected.value || resolving.value || !aiJob) return
  resolving.value = true
  const seq = ++submitSeq
  aiJob.hurry()
  const white = await aiJob.move
  if (seq !== submitSeq) return
  const next = settleFrame(game.value, { black: selected.value, white })
  history.value.push(next)
  reviewIndex.value = null
  game.value = next
  selected.value = null
  resolving.value = false
  if (next.phase === 'playing') beginFrame()
}

function restart(): void {
  submitSeq++
  game.value = createGame(mode.value)
  history.value = []
  reviewIndex.value = null
  selected.value = null
  resolving.value = false
  overlayDismissed.value = false
  beginFrame()
}

function applyConfig(config: GameConfig): void {
  showConfig.value = false
  mode.value = config.mode
  difficulty.value = config.difficulty
  saveConfig(config)
  restart()
}

// 退出优先按页面栈回退；分享直达时栈里只有本页，改用 redirect 回首页，不再堆栈。
function exitGame(): void {
  if (Taro.getCurrentPages().length > 1) Taro.navigateBack()
  else Taro.redirectTo({ url: '/pages/index/index' })
}
</script>

<template>
  <view class="page">
    <view class="head">
      <view class="seat">
        <view class="mini-stone" />
        <text>你执黑</text>
        <text v-if="!playing" class="head-result" :class="resultCls">· {{ resultChar }}</text>
      </view>
      <view class="vs">
        <text>AI · {{ DIFFICULTY_LABELS[difficulty] }}</text>
        <text class="vs-exit" @tap="confirmingExit = true">退出</text>
      </view>
      <text class="mode" @tap="showRules = true">{{ MODE_LABELS[mode] }}模式 ?</text>
    </view>

    <view class="status">
      <text class="frame">第 {{ displayFrame }} 回合</text>
      <view class="ai-status" :class="aiStatus.cls">
        <view class="dot" :class="aiStatus.dot" />
        <text>{{ aiStatus.text }}</text>
      </view>
      <text class="timer">{{ elapsedSeconds }}s/<text class="inf">∞</text></text>
    </view>

    <view class="board-wrap">
      <Board
        :state="shown"
        :selected="reviewState ? null : selected"
        :submitted="resolving"
        :last-moves="shown.lastMoves"
        :interactive="playing && !resolving"
        @select="onSelect"
      />
      <view v-if="!playing && !overlayDismissed" class="overlay" @tap="overlayDismissed = true">
        <text class="stamp" :class="resultCls">{{ resultChar }}</text>
        <text class="overlay-hint">点击查看棋盘</text>
      </view>
    </view>

    <view v-if="playing" class="actions">
      <view
        class="btn btn-primary"
        :class="{ 'btn-disabled': !resolving && !selected }"
        @tap="resolving ? cancelChoice() : submit()"
      >
        {{ resolving ? '取消提交' : selected ? '确认提交' : '点击棋盘选择落点' }}
      </view>
    </view>
    <view v-else class="actions">
      <view class="btn btn-primary" @tap="showConfig = true">再来一局</view>
      <view v-if="reviewAvailable" class="review">
        <view class="btn btn-secondary" :class="{ 'btn-disabled': reviewAtFirst }" @tap="review(-1)">
          上一回合
        </view>
        <view class="btn btn-secondary" :class="{ 'btn-disabled': reviewAtLatest }" @tap="review(1)">
          下一回合
        </view>
      </view>
    </view>

    <view class="footer">
      <text class="exit" @tap="playing ? (confirmingExit = true) : exitGame()">返回首页</text>
    </view>

    <RulesDialog v-if="showRules" @close="showRules = false" />

    <ConfigDialog
      v-if="showConfig"
      :mode="mode"
      :difficulty="difficulty"
      @cancel="showConfig = false"
      @confirm="applyConfig"
    />

    <view v-if="confirmingExit" class="mask">
      <view class="panel">
        <text class="panel-title">退出人机对战？</text>
        <text class="panel-text">退出后本局将清空，无法继续。</text>
        <view class="panel-actions">
          <view class="dialog-btn dialog-btn-secondary" @tap="confirmingExit = false">取消</view>
          <view class="dialog-btn dialog-btn-danger" @tap="exitGame">退出</view>
        </view>
      </view>
    </view>
  </view>
</template>

<style>
.page {
  min-height: 100vh;
  padding: 24rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 20rpx;
  box-sizing: border-box;
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
.head-result {
  font-weight: 700;
}
.res-won {
  color: #f59e0b;
}
.res-lost {
  color: #a8a29e;
}
.res-draw {
  color: #ffffff;
  text-shadow: 0 1rpx 2rpx rgba(28, 25, 23, 0.45);
}
.vs {
  display: flex;
  align-items: center;
  gap: 12rpx;
  background: rgba(255, 255, 255, 0.7);
  padding: 4rpx 16rpx;
  border-radius: 999rpx;
  font-size: 24rpx;
  color: #78716c;
}
.vs-exit {
  color: #f87171;
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
.board-wrap {
  position: relative;
  width: 690rpx;
  height: 690rpx;
}
.overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16rpx;
}
.stamp {
  font-size: 220rpx;
  line-height: 1;
  font-weight: 900;
  font-family: STKaiti, KaiTi, 'Noto Serif SC', serif;
  text-shadow: 0 6rpx 16rpx rgba(28, 25, 23, 0.45);
  animation: stamp 0.4s ease-out;
}
.stamp.res-won {
  color: #f59e0b;
}
.stamp.res-lost {
  color: #78716c;
}
.stamp.res-draw {
  color: #f5f5f4;
}
.overlay-hint {
  padding: 8rpx 24rpx;
  border-radius: 999rpx;
  background: rgba(0, 0, 0, 0.3);
  font-size: 24rpx;
  color: #ffffff;
}
@keyframes stamp {
  from {
    transform: rotate(-8deg) scale(2.4);
    opacity: 0;
  }
  60% {
    transform: rotate(-8deg) scale(0.92);
    opacity: 1;
  }
  to {
    transform: rotate(-8deg) scale(1);
    opacity: 1;
  }
}
.actions {
  width: 690rpx;
  display: flex;
  flex-direction: column;
  gap: 16rpx;
}
.review {
  display: flex;
  gap: 16rpx;
}
.review .btn {
  flex: 1;
  width: auto;
}
.footer {
  margin-top: auto;
  padding-top: 12rpx;
}
.exit {
  font-size: 24rpx;
  font-weight: 500;
  color: #a8a29e;
  padding: 8rpx;
}
.mask {
  position: fixed;
  inset: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 48rpx;
  background: rgba(0, 0, 0, 0.4);
}
.panel {
  width: 100%;
  max-width: 640rpx;
  display: flex;
  flex-direction: column;
  gap: 32rpx;
  padding: 48rpx;
  border-radius: 32rpx;
  background: #ffffff;
  box-shadow: 0 20rpx 50rpx rgba(0, 0, 0, 0.15);
  box-sizing: border-box;
}
.panel-title {
  font-size: 32rpx;
  font-weight: 600;
  color: #292524;
}
.panel-text {
  font-size: 28rpx;
  color: #78716c;
}
.panel-actions {
  display: flex;
  gap: 16rpx;
}
.dialog-btn {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20rpx 0;
  border-radius: 24rpx;
  font-size: 30rpx;
  font-weight: 500;
}
.dialog-btn-secondary {
  background: #e7e5e4;
  color: #44403c;
}
.dialog-btn-danger {
  background: #ef4444;
  color: #ffffff;
}
</style>
