<script setup lang="ts">
import { computed } from 'vue'
import { BOARD_SIZE, cellAt, type GameState, type Point } from '@gomoku/engine/game'

const props = defineProps<{
  state: GameState
  selected: Point | null
  lastMoves: Point[]
  interactive: boolean
}>()
const emit = defineEmits<{ select: [Point] }>()

// 棋盘几何（rpx）：整盘 690，四周留白 PAD，14 段等分得到格距 U。
const BOARD = 690
const PAD = 30
const U = (BOARD - PAD * 2) / (BOARD_SIZE - 1)
const STONE = U * 0.82
const INNER = BOARD - PAD * 2
const STARS = [
  { x: 3, y: 3 },
  { x: 11, y: 3 },
  { x: 7, y: 7 },
  { x: 3, y: 11 },
  { x: 11, y: 11 },
]
const lines = Array.from({ length: BOARD_SIZE }, (_, i) => PAD + i * U)

type Kind = 'empty' | 'black' | 'white' | 'forbidden' | 'minus' | 'preview'

function kindOf(x: number, y: number): Kind {
  const cell = cellAt(props.state, { x, y })
  if (cell === 'black' || cell === 'white' || cell === 'forbidden' || cell === 'minus') return cell
  if (props.interactive && props.selected && props.selected.x === x && props.selected.y === y)
    return 'preview'
  return 'empty'
}

const cells = computed(() => {
  const out: { x: number; y: number; left: number; top: number; kind: Kind; last: boolean }[] = []
  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      out.push({
        x,
        y,
        left: PAD + x * U - U / 2,
        top: PAD + y * U - U / 2,
        kind: kindOf(x, y),
        last: props.lastMoves.some((p) => p.x === x && p.y === y),
      })
    }
  }
  return out
})

function onTap(cell: { x: number; y: number }): void {
  if (props.interactive) emit('select', { x: cell.x, y: cell.y })
}
</script>

<template>
  <view class="board" :style="`width:${BOARD}rpx;height:${BOARD}rpx`">
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
      :style="`left:${PAD + s.x * U - 5}rpx;top:${PAD + s.y * U - 5}rpx`"
    />
    <view
      v-for="c in cells"
      :key="`${c.x}-${c.y}`"
      class="hit"
      :style="`left:${c.left}rpx;top:${c.top}rpx;width:${U}rpx;height:${U}rpx`"
      @tap="onTap(c)"
    >
      <view
        v-if="c.kind !== 'empty'"
        :class="['stone', `stone-${c.kind}`, c.last ? 'stone-last' : '']"
        :style="`width:${STONE}rpx;height:${STONE}rpx`"
      >
        <text v-if="c.kind === 'forbidden'" class="mark">×</text>
        <text v-else-if="c.kind === 'minus'" class="mark mark-minus">−</text>
      </view>
    </view>
  </view>
</template>

<style>
.board {
  position: relative;
  background: #f2e4c3;
  border-radius: 16rpx;
  box-shadow: 0 6rpx 20rpx rgba(0, 0, 0, 0.12);
}
.line-h {
  position: absolute;
  height: 1px;
  background: #b59b6a;
}
.line-v {
  position: absolute;
  width: 1px;
  background: #b59b6a;
}
.star {
  position: absolute;
  width: 10rpx;
  height: 10rpx;
  border-radius: 50%;
  background: #8a734a;
}
.hit {
  position: absolute;
  display: flex;
  align-items: center;
  justify-content: center;
}
.stone {
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  box-shadow: 0 2rpx 4rpx rgba(0, 0, 0, 0.25);
}
.stone-black {
  background: #1c1917;
}
.stone-white {
  background: #fafaf9;
  border: 1px solid #cfc9c1;
}
.stone-preview {
  background: #1c1917;
  opacity: 0.4;
  box-shadow: none;
}
.stone-forbidden {
  background: #e7e5e4;
  box-shadow: none;
}
.stone-minus {
  background: #d6d3d1;
  box-shadow: none;
}
.stone-last {
  border: 3rpx solid #10b981;
}
.mark {
  color: #b91c1c;
  font-size: 30rpx;
  line-height: 1;
  font-weight: 700;
}
.mark-minus {
  color: #57534e;
}
</style>
