<script setup lang="ts">
import { computed } from 'vue'
import { BOARD_SIZE, cellAt, type GameState, type Point, type Seat } from '@/engine/game'

const props = defineProps<{
  state: GameState
  seat: Seat
  selected: Point | null
  lastMoves: Point[]
  interactive: boolean
}>()

const emit = defineEmits<{ select: [point: Point] }>()

const U = 40
const PAD = 34
const SIZE = (BOARD_SIZE - 1) * U + PAD * 2
const STONE_R = U * 0.46

const STARS: Point[] = [
  { x: 3, y: 3 },
  { x: 11, y: 3 },
  { x: 7, y: 7 },
  { x: 3, y: 11 },
  { x: 11, y: 11 },
]

const ALL_POINTS: Point[] = Array.from({ length: BOARD_SIZE * BOARD_SIZE }, (_, i) => ({
  x: i % BOARD_SIZE,
  y: Math.floor(i / BOARD_SIZE),
}))

function pos(i: number): number {
  return PAD + i * U
}

const stones = computed(() =>
  ALL_POINTS.filter((p) => {
    const cell = cellAt(props.state, p)
    return cell === 'p1' || cell === 'p2'
  }).map((p) => ({ ...p, cell: cellAt(props.state, p) as 'p1' | 'p2' })),
)

const forbidden = computed(() => ALL_POINTS.filter((p) => cellAt(props.state, p) === 'forbidden'))

function isLastMove(p: Point): boolean {
  return props.lastMoves.some((m) => m.x === p.x && m.y === p.y)
}
</script>

<template>
  <svg
    :viewBox="`0 0 ${SIZE} ${SIZE}`"
    class="w-full max-w-md touch-manipulation select-none drop-shadow-md"
    role="img"
    aria-label="棋盘"
  >
    <defs>
      <radialGradient id="stone-p1" cx="35%" cy="30%" r="80%">
        <stop offset="0%" stop-color="#5a5a5a" />
        <stop offset="100%" stop-color="#111111" />
      </radialGradient>
      <radialGradient id="stone-p2" cx="35%" cy="30%" r="80%">
        <stop offset="0%" stop-color="#ffffff" />
        <stop offset="100%" stop-color="#d6d3d1" />
      </radialGradient>
      <linearGradient id="wood" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="var(--color-wood)" />
        <stop offset="100%" stop-color="var(--color-wood-deep)" />
      </linearGradient>
    </defs>

    <rect :width="SIZE" :height="SIZE" rx="14" fill="url(#wood)" />

    <g stroke="var(--color-line)" stroke-width="1.5">
      <line
        v-for="i in BOARD_SIZE"
        :key="`h${i}`"
        :x1="pos(0)"
        :x2="pos(BOARD_SIZE - 1)"
        :y1="pos(i - 1)"
        :y2="pos(i - 1)"
      />
      <line
        v-for="i in BOARD_SIZE"
        :key="`v${i}`"
        :x1="pos(i - 1)"
        :x2="pos(i - 1)"
        :y1="pos(0)"
        :y2="pos(BOARD_SIZE - 1)"
      />
    </g>

    <circle
      v-for="star in STARS"
      :key="`star${star.x},${star.y}`"
      :cx="pos(star.x)"
      :cy="pos(star.y)"
      r="4.5"
      fill="var(--color-line)"
    />

    <g
      v-for="stone in stones"
      :key="`s${stone.x},${stone.y}`"
      class="origin-center animate-[stone-drop_0.18s_ease-out] [transform-box:fill-box]"
    >
      <circle
        :cx="pos(stone.x)"
        :cy="pos(stone.y)"
        :r="STONE_R"
        :fill="`url(#stone-${stone.cell})`"
        :stroke="stone.cell === 'p2' ? '#a8a29e' : 'none'"
        stroke-width="1"
      />
      <circle
        v-if="isLastMove(stone)"
        :cx="pos(stone.x)"
        :cy="pos(stone.y)"
        r="5"
        :fill="stone.cell === 'p1' ? '#ffffff' : '#1c1917'"
        opacity="0.85"
      />
    </g>

    <g
      v-for="p in forbidden"
      :key="`f${p.x},${p.y}`"
      stroke="#ef4444"
      stroke-width="4"
      stroke-linecap="round"
      class="origin-center animate-[mark-pop_0.25s_ease-out] [transform-box:fill-box]"
    >
      <line :x1="pos(p.x) - 9" :y1="pos(p.y) - 9" :x2="pos(p.x) + 9" :y2="pos(p.y) + 9" />
      <line :x1="pos(p.x) - 9" :y1="pos(p.y) + 9" :x2="pos(p.x) + 9" :y2="pos(p.y) - 9" />
    </g>

    <g v-if="selected">
      <circle
        :cx="pos(selected.x)"
        :cy="pos(selected.y)"
        :r="STONE_R"
        :fill="`url(#stone-${seat})`"
        opacity="0.55"
      />
      <circle
        :cx="pos(selected.x)"
        :cy="pos(selected.y)"
        :r="STONE_R + 4"
        fill="none"
        :stroke="seat === 'p1' ? '#1c1917' : '#ffffff'"
        stroke-width="2.5"
        class="animate-[breathe_1.6s_ease-in-out_infinite]"
      />
    </g>

    <g v-if="interactive">
      <circle
        v-for="p in ALL_POINTS"
        :key="`t${p.x},${p.y}`"
        :cx="pos(p.x)"
        :cy="pos(p.y)"
        :r="U / 2"
        fill="transparent"
        class="cursor-pointer"
        @click="emit('select', p)"
      />
    </g>
  </svg>
</template>
