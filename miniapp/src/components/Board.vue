<script setup lang="ts">
import { computed } from 'vue'
import Taro from '@tarojs/taro'
import { BOARD_SIZE, cellAt, type CellState, type GameState, type Point } from '@gomoku/engine/game'

const props = defineProps<{
  state: GameState
  selected: Point | null
  submitted: boolean
  lastMoves: Point[]
  interactive: boolean
}>()
const emit = defineEmits<{ select: [Point] }>()

// 棋盘几何（rpx）：整盘 690，四周留白 PAD，14 段等分得到格距 U。比例对齐 web（U=40 坐标系）。
const BOARD = 690
const PAD = 30
const U = (BOARD - PAD * 2) / (BOARD_SIZE - 1)
const STONE_R = U * 0.46
const INNER = BOARD - PAD * 2
const LAST_DOT = 11
const LINE_W = 8
// 选点标记都挂在预览棋子盒子里、按其边缘定位，且外扩量取偶数 rpx：模拟器 1rpx = 0.5px，
// 子盒子边坐标与棋子只差整像素，亚像素吸附时取整方向一致，环与括号才与棋子同心；
// 真机 DPR ≥ 2，吸附误差本就不可见。呼吸环外扩 8（4 间隙 + 4 线宽），四角括号外扩 6。
const RING_OUT = 8
const MARK_OUT = 6
const MARK_L = 10
const MARK_CORNERS = [
  ['tl', -1, -1],
  ['tr', 1, -1],
  ['bl', -1, 1],
  ['br', 1, 1],
] as const
const STARS = [
  { x: 3, y: 3 },
  { x: 11, y: 3 },
  { x: 7, y: 7 },
  { x: 3, y: 11 },
  { x: 11, y: 11 },
]
const lines = Array.from({ length: BOARD_SIZE }, (_, i) => PAD + i * U)

function pos(i: number): number {
  return PAD + i * U
}

// 首回合限落中央 3×3（除天元）：3×3 外整盘压暗、天元单独压暗，虚线框呼吸提示。
const CENTER = (BOARD_SIZE - 1) / 2
const ZONE_PAD = U * 0.7
const ZONE_POS = PAD + (CENTER - 1) * U - ZONE_PAD
const ZONE_SIZE = U * 2 + ZONE_PAD * 2
const TY_SIZE = U * 0.8
const TY_POS = PAD + CENTER * U - TY_SIZE / 2
// 亮区圆角半径（对齐 web 的 rx=12/U40 比例）；洞的圆角用四个反圆角渐变补丁实现。
const ZONE_R = 14
const openingZone = computed(() => props.state.frame === 1 && props.state.phase === 'playing')

const ALL_POINTS: Point[] = Array.from({ length: BOARD_SIZE * BOARD_SIZE }, (_, i) => ({
  x: i % BOARD_SIZE,
  y: Math.floor(i / BOARD_SIZE),
}))

function isLast(p: Point): boolean {
  return props.lastMoves.some((m) => m.x === p.x && m.y === p.y)
}

const stones = computed(() =>
  ALL_POINTS.filter((p) => {
    const cell = cellAt(props.state, p)
    return cell === 'black' || cell === 'white'
  }).map((p) => ({
    ...p,
    cell: cellAt(props.state, p) as 'black' | 'white',
    last: isLast(p),
  })),
)

const forbidden = computed(() => ALL_POINTS.filter((p) => cellAt(props.state, p) === 'forbidden'))

// 湮灭动画：从连线原点向外逐格延迟消失，与 web 的 delay 公式一致。
const VANISH_BASE_MS = 280
const VANISH_STEP_MS = 90

const vanishStones = computed(() => {
  const map = new Map<string, { x: number; y: number; cell: CellState; delay: number }>()
  for (const group of props.state.cleared) {
    for (const { x, y, cell } of group.cells) {
      const delay =
        VANISH_BASE_MS +
        Math.max(Math.abs(x - group.origin.x), Math.abs(y - group.origin.y)) * VANISH_STEP_MS
      const key = `${x},${y}`
      const seen = map.get(key)
      if (!seen || delay < seen.delay) map.set(key, { x, y, cell, delay })
    }
  }
  return [...map.values()]
})

// 线段（湮灭射线 / 胜利连线）转成居中定位 + 旋转的横条；内层再做 scaleX 描画动画。
type Bar = { key: string; left: number; top: number; len: number; angle: number }

function toBar(key: string, from: Point, to: Point): Bar {
  const x1 = pos(from.x)
  const y1 = pos(from.y)
  const x2 = pos(to.x)
  const y2 = pos(to.y)
  const len = Math.hypot(x2 - x1, y2 - y1)
  return {
    key,
    left: (x1 + x2) / 2 - len / 2,
    top: (y1 + y2) / 2 - LINE_W / 2,
    len,
    angle: (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI,
  }
}

const rays = computed(() => {
  const out: Bar[] = []
  for (const group of props.state.cleared) {
    const farthest = new Map<string, { point: Point; dist: number }>()
    for (const { x, y } of group.cells) {
      const dx = Math.sign(x - group.origin.x)
      const dy = Math.sign(y - group.origin.y)
      if (!dx && !dy) continue
      const dist = Math.max(Math.abs(x - group.origin.x), Math.abs(y - group.origin.y))
      const key = `${dx},${dy}`
      const seen = farthest.get(key)
      if (!seen || dist > seen.dist) farthest.set(key, { point: { x, y }, dist })
    }
    for (const [key, { point }] of farthest) {
      out.push(toBar(`${group.origin.x},${group.origin.y}>${key}`, group.origin, point))
    }
  }
  return out
})

const winLines = computed(() =>
  props.state.winningLines.map((line, i) => toBar(`w${i}`, line[0], line[line.length - 1])),
)

// 整盘单一 tap：取点击页面坐标，对照棋盘实际矩形换算 rpx，吸附到最近交叉点。
// 比逐格小方块（约 22px）好点得多，也把 225 个事件节点降为 1 个。
type TapEvent = {
  detail?: { x?: number; y?: number }
  changedTouches?: { pageX: number; pageY: number }[]
  pageX?: number
  pageY?: number
}

function onBoardTap(e: TapEvent): void {
  if (!props.interactive) return
  const px = e.detail?.x ?? e.changedTouches?.[0]?.pageX ?? e.pageX
  const py = e.detail?.y ?? e.changedTouches?.[0]?.pageY ?? e.pageY
  if (px == null || py == null) return
  Taro.createSelectorQuery()
    .select('#board')
    .boundingClientRect((rect) => {
      const r = rect as { left: number; top: number; width: number } | null
      if (!r || !r.width) return
      const scale = BOARD / r.width
      const x = Math.round(((px - r.left) * scale - PAD) / U)
      const y = Math.round(((py - r.top) * scale - PAD) / U)
      if (x < 0 || y < 0 || x >= BOARD_SIZE || y >= BOARD_SIZE) return
      emit('select', { x, y })
    })
    .exec()
}
</script>

<template>
  <view id="board" class="board" :style="`width:${BOARD}rpx;height:${BOARD}rpx`" @tap="onBoardTap">
    <view
      v-for="p in lines"
      :key="`h${p}`"
      class="line-h"
      :style="`top:${p}rpx;left:${PAD}rpx;width:${INNER}rpx`"
    />
    <view
      v-for="p in lines"
      :key="`v${p}`"
      class="line-v"
      :style="`left:${p}rpx;top:${PAD}rpx;height:${INNER}rpx`"
    />
    <view
      v-for="s in STARS"
      :key="`s${s.x}-${s.y}`"
      class="star"
      :style="`left:${pos(s.x) - 5}rpx;top:${pos(s.y) - 5}rpx`"
    />

    <template v-if="openingZone">
      <view class="dim" :style="`left:0;top:0;width:${BOARD}rpx;height:${ZONE_POS}rpx`" />
      <view
        class="dim"
        :style="`left:0;top:${ZONE_POS + ZONE_SIZE}rpx;width:${BOARD}rpx;height:${BOARD - ZONE_POS - ZONE_SIZE}rpx`"
      />
      <view
        class="dim"
        :style="`left:0;top:${ZONE_POS}rpx;width:${ZONE_POS}rpx;height:${ZONE_SIZE}rpx`"
      />
      <view
        class="dim"
        :style="`left:${ZONE_POS + ZONE_SIZE}rpx;top:${ZONE_POS}rpx;width:${BOARD - ZONE_POS - ZONE_SIZE}rpx;height:${ZONE_SIZE}rpx`"
      />
      <view
        class="zone-corner corner-tl"
        :style="`left:${ZONE_POS}rpx;top:${ZONE_POS}rpx;width:${ZONE_R}rpx;height:${ZONE_R}rpx`"
      />
      <view
        class="zone-corner corner-tr"
        :style="`left:${ZONE_POS + ZONE_SIZE - ZONE_R}rpx;top:${ZONE_POS}rpx;width:${ZONE_R}rpx;height:${ZONE_R}rpx`"
      />
      <view
        class="zone-corner corner-bl"
        :style="`left:${ZONE_POS}rpx;top:${ZONE_POS + ZONE_SIZE - ZONE_R}rpx;width:${ZONE_R}rpx;height:${ZONE_R}rpx`"
      />
      <view
        class="zone-corner corner-br"
        :style="`left:${ZONE_POS + ZONE_SIZE - ZONE_R}rpx;top:${ZONE_POS + ZONE_SIZE - ZONE_R}rpx;width:${ZONE_R}rpx;height:${ZONE_R}rpx`"
      />
      <view
        class="dim dim-center"
        :style="`left:${TY_POS}rpx;top:${TY_POS}rpx;width:${TY_SIZE}rpx;height:${TY_SIZE}rpx`"
      />
      <view
        class="zone-frame"
        :style="`left:${ZONE_POS}rpx;top:${ZONE_POS}rpx;right:${BOARD - ZONE_POS - ZONE_SIZE}rpx;bottom:${BOARD - ZONE_POS - ZONE_SIZE}rpx`"
      />
    </template>

    <view
      v-for="c in stones"
      :key="`s${c.x}-${c.y}`"
      :class="['stone', `stone-${c.cell}`]"
      :style="`left:${pos(c.x) - STONE_R}rpx;top:${pos(c.y) - STONE_R}rpx;width:${STONE_R * 2}rpx;height:${STONE_R * 2}rpx`"
    >
      <view v-if="c.last" :class="['last-dot', `last-dot-${c.cell}`]" />
    </view>

    <view
      v-for="p in forbidden"
      :key="`f${p.x}-${p.y}`"
      class="mark-cell mark-forbidden"
      :style="`left:${pos(p.x) - STONE_R}rpx;top:${pos(p.y) - STONE_R}rpx;width:${STONE_R * 2}rpx;height:${STONE_R * 2}rpx`"
    >
      <view class="bar bar-cross bar-cross-a" />
      <view class="bar bar-cross bar-cross-b" />
      <view v-if="isLast(p)" class="last-dot last-dot-mark" />
    </view>

    <view
      v-for="v in vanishStones"
      :key="`v${state.frame}-${v.x}-${v.y}`"
      class="vanish"
      :style="`left:${pos(v.x) - STONE_R}rpx;top:${pos(v.y) - STONE_R}rpx;width:${STONE_R * 2}rpx;height:${STONE_R * 2}rpx;animation-delay:${v.delay}ms`"
    >
      <view v-if="v.cell === 'black' || v.cell === 'white'" :class="['stone-still', `stone-${v.cell}`]" />
      <view v-else-if="v.cell === 'forbidden'" class="mark-still mark-forbidden">
        <view class="bar bar-cross bar-cross-a" />
        <view class="bar bar-cross bar-cross-b" />
      </view>
    </view>

    <view
      v-for="ray in rays"
      :key="`r${state.frame}-${ray.key}`"
      class="beam"
      :style="`left:${ray.left}rpx;top:${ray.top}rpx;width:${ray.len}rpx;height:${LINE_W}rpx;transform:rotate(${ray.angle}deg)`"
    >
      <view class="beam-fill beam-ray" />
    </view>

    <view
      v-for="line in winLines"
      :key="`w${line.key}`"
      class="beam"
      :style="`left:${line.left}rpx;top:${line.top}rpx;width:${line.len}rpx;height:${LINE_W}rpx;transform:rotate(${line.angle}deg)`"
    >
      <view class="beam-fill beam-win" />
    </view>

    <view
      v-if="selected"
      class="pick"
      :style="`left:${pos(selected.x) - STONE_R}rpx;top:${pos(selected.y) - STONE_R}rpx;width:${STONE_R * 2}rpx;height:${STONE_R * 2}rpx`"
    >
      <view class="stone-still stone-black preview" />
      <view
        v-if="!submitted"
        class="ring"
        :style="`left:${-RING_OUT}rpx;top:${-RING_OUT}rpx;right:${-RING_OUT}rpx;bottom:${-RING_OUT}rpx`"
      />
      <view
        v-for="[corner, sx, sy] in MARK_CORNERS"
        v-else
        :key="corner"
        :class="['mark-corner', `mark-corner-${corner}`]"
        :style="`${sx > 0 ? 'right' : 'left'}:${-MARK_OUT}rpx;${sy > 0 ? 'bottom' : 'top'}:${-MARK_OUT}rpx;width:${MARK_L}rpx;height:${MARK_L}rpx`"
      />
    </view>
  </view>
</template>

<style>
.board {
  position: relative;
  overflow: hidden;
  background: linear-gradient(135deg, #e0b26e, #d9a55f);
  border-radius: 16rpx;
  box-shadow: 0 6rpx 20rpx rgba(0, 0, 0, 0.12);
}
.line-h {
  position: absolute;
  height: 1px;
  background: #7c5a33;
}
.line-v {
  position: absolute;
  width: 1px;
  background: #7c5a33;
}
.star {
  position: absolute;
  width: 10rpx;
  height: 10rpx;
  border-radius: 50%;
  background: #7c5a33;
}
.dim {
  position: absolute;
  background: rgba(28, 25, 23, 0.35);
}
.dim-center {
  border-radius: 8rpx;
}
.zone-corner {
  position: absolute;
}
.corner-tl {
  background: radial-gradient(circle at 100% 100%, transparent 14rpx, rgba(28, 25, 23, 0.35) 14rpx);
}
.corner-tr {
  background: radial-gradient(circle at 0% 100%, transparent 14rpx, rgba(28, 25, 23, 0.35) 14rpx);
}
.corner-bl {
  background: radial-gradient(circle at 100% 0%, transparent 14rpx, rgba(28, 25, 23, 0.35) 14rpx);
}
.corner-br {
  background: radial-gradient(circle at 0% 0%, transparent 14rpx, rgba(28, 25, 23, 0.35) 14rpx);
}
.zone-frame {
  position: absolute;
  border: 2px dashed #7c5a33;
  border-radius: 14rpx;
  animation: breathe 1.6s ease-in-out infinite;
}
.stone,
.stone-still {
  position: absolute;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
}
.stone {
  animation: stone-drop 0.18s ease-out;
}
.stone-black {
  background: radial-gradient(circle at 35% 30%, #5a5a5a, #111111);
}
.stone-white {
  background: radial-gradient(circle at 35% 30%, #ffffff, #d6d3d1);
  box-shadow: inset 0 0 0 1px #a8a29e;
}
.last-dot {
  width: 11rpx;
  height: 11rpx;
  border-radius: 50%;
  opacity: 0.85;
}
.last-dot-black {
  background: #ffffff;
}
.last-dot-white {
  background: #1c1917;
}
/* 白色描边遮住穿过中心的符号线，观感与棋子上的圆点一致 */
.last-dot-mark {
  box-sizing: content-box;
  border: 2.5rpx solid #ffffff;
  background: #1c1917;
}
.mark-cell,
.mark-still {
  position: absolute;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.75);
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
}
.mark-cell {
  animation: mark-pop 0.25s ease-out;
}
.mark-still {
  width: 100%;
  height: 100%;
}
.mark-forbidden {
  box-shadow: inset 0 0 0 3rpx #ef4444;
  background: rgba(239, 68, 68, 0.32);
}
.bar {
  position: absolute;
  height: 3rpx;
  border-radius: 3rpx;
}
.bar-cross {
  width: 64%;
  background: #ef4444;
}
.bar-cross-a {
  transform: rotate(45deg);
}
.bar-cross-b {
  transform: rotate(-45deg);
}
.vanish {
  position: absolute;
  animation: vanish 0.3s ease-in both;
}
.beam {
  position: absolute;
}
.beam-fill {
  width: 100%;
  height: 100%;
  border-radius: 4rpx;
  background: #fbbf24;
  transform-origin: left center;
}
.beam-ray {
  animation: beam-ray 0.5s ease-out forwards;
}
.beam-win {
  opacity: 0.9;
  animation: beam-draw 0.5s ease-out forwards;
}
.pick {
  position: absolute;
}
.preview {
  left: 0;
  top: 0;
  right: 0;
  bottom: 0;
  opacity: 0.55;
}
.ring {
  position: absolute;
  border: 4rpx solid #1c1917;
  border-radius: 50%;
  box-sizing: border-box;
  animation: breathe 1.6s ease-in-out infinite;
}
.mark-corner {
  position: absolute;
  box-sizing: border-box;
  border: 0 solid #1c1917;
  animation: mark-pop 0.25s ease-out;
}
.mark-corner-tl {
  border-top-width: 3rpx;
  border-left-width: 3rpx;
  border-top-left-radius: 3rpx;
}
.mark-corner-tr {
  border-top-width: 3rpx;
  border-right-width: 3rpx;
  border-top-right-radius: 3rpx;
}
.mark-corner-bl {
  border-bottom-width: 3rpx;
  border-left-width: 3rpx;
  border-bottom-left-radius: 3rpx;
}
.mark-corner-br {
  border-bottom-width: 3rpx;
  border-right-width: 3rpx;
  border-bottom-right-radius: 3rpx;
}
@keyframes breathe {
  0%,
  100% {
    opacity: 0.9;
  }
  50% {
    opacity: 0.35;
  }
}
@keyframes stone-drop {
  from {
    transform: scale(1.5);
    opacity: 0;
  }
  to {
    transform: scale(1);
    opacity: 1;
  }
}
@keyframes mark-pop {
  from {
    transform: scale(0.4);
    opacity: 0;
  }
  to {
    transform: scale(1);
    opacity: 1;
  }
}
@keyframes vanish {
  from {
    transform: scale(1);
    opacity: 1;
  }
  to {
    transform: scale(0);
    opacity: 0;
  }
}
@keyframes beam-ray {
  0% {
    transform: scaleX(0);
    opacity: 0.9;
  }
  55% {
    transform: scaleX(1);
    opacity: 0.9;
  }
  100% {
    transform: scaleX(1);
    opacity: 0;
  }
}
@keyframes beam-draw {
  from {
    transform: scaleX(0);
  }
  to {
    transform: scaleX(1);
  }
}
</style>
