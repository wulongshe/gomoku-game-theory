<script setup lang="ts">
import { computed } from 'vue'
import {
  BOARD_SIZE,
  cellAt,
  type CellState,
  type ClearedGroup,
  type GameState,
  type Point,
  type Seat,
} from '@gomoku/engine/game'

const props = defineProps<{
  state: GameState
  seat: Seat
  selected: Point | null
  submitted: boolean
  lastMoves: Point[]
  vanishing: ClearedGroup[]
  interactive: boolean
}>()

const emit = defineEmits<{ select: [point: Point] }>()

const U = 40
const PAD = 34
const SIZE = (BOARD_SIZE - 1) * U + PAD * 2
const STONE_R = U * 0.46

const MARK_D = STONE_R
const MARK_L = 7
const MARK_CORNERS = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
] as const

const FORBID_R = STONE_R

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

const CENTER = (BOARD_SIZE - 1) / 2
const ZONE_PAD = U * 0.7
const openingZone = computed(() => props.state.frame === 1 && props.state.phase === 'playing')

const stones = computed(() =>
  ALL_POINTS.filter((p) => {
    const cell = cellAt(props.state, p)
    return cell === 'black' || cell === 'white'
  }).map((p) => ({ ...p, cell: cellAt(props.state, p) as 'black' | 'white' })),
)

const forbidden = computed(() => ALL_POINTS.filter((p) => cellAt(props.state, p) === 'forbidden'))

const VANISH_BASE_MS = 280
const VANISH_STEP_MS = 90

const vanishStones = computed(() => {
  const map = new Map<string, { x: number; y: number; cell: CellState; delay: number }>()
  for (const group of props.vanishing) {
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

const rays = computed(() => {
  const out: { key: string; from: Point; to: Point }[] = []
  for (const group of props.vanishing) {
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
      out.push({ key: `${group.origin.x},${group.origin.y}>${key}`, from: group.origin, to: point })
    }
  }
  return out
})

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
      <radialGradient id="stone-black" cx="35%" cy="30%" r="80%">
        <stop offset="0%" stop-color="#5a5a5a" />
        <stop offset="100%" stop-color="#111111" />
      </radialGradient>
      <radialGradient id="stone-white" cx="35%" cy="30%" r="80%">
        <stop offset="0%" stop-color="#ffffff" />
        <stop offset="100%" stop-color="#d6d3d1" />
      </radialGradient>
      <linearGradient id="wood" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="var(--color-wood)" />
        <stop offset="100%" stop-color="var(--color-wood-deep)" />
      </linearGradient>
      <mask id="opening-mask">
        <rect :width="SIZE" :height="SIZE" fill="#ffffff" />
        <rect
          :x="pos(CENTER - 1) - ZONE_PAD"
          :y="pos(CENTER - 1) - ZONE_PAD"
          :width="U * 2 + ZONE_PAD * 2"
          :height="U * 2 + ZONE_PAD * 2"
          rx="12"
          fill="#000000"
        />
        <rect
          :x="pos(CENTER) - U * 0.4"
          :y="pos(CENTER) - U * 0.4"
          :width="U * 0.8"
          :height="U * 0.8"
          rx="7"
          fill="#ffffff"
        />
      </mask>
      <symbol id="corner-mark" overflow="visible">
        <path
          v-for="[sx, sy] in MARK_CORNERS"
          :key="`c${sx},${sy}`"
          :d="`M ${sx * (MARK_D - MARK_L)} ${sy * MARK_D} L ${sx * MARK_D} ${sy * MARK_D} L ${sx * MARK_D} ${sy * (MARK_D - MARK_L)}`"
        />
      </symbol>
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

    <g v-if="openingZone">
      <rect
        :width="SIZE"
        :height="SIZE"
        rx="14"
        fill="#1c1917"
        opacity="0.35"
        mask="url(#opening-mask)"
      />
      <rect
        :x="pos(CENTER - 1) - ZONE_PAD"
        :y="pos(CENTER - 1) - ZONE_PAD"
        :width="U * 2 + ZONE_PAD * 2"
        :height="U * 2 + ZONE_PAD * 2"
        rx="12"
        fill="none"
        stroke="var(--color-line)"
        stroke-width="2"
        stroke-dasharray="6 6"
        class="animate-[breathe_1.6s_ease-in-out_infinite]"
      />
    </g>

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
        :stroke="stone.cell === 'white' ? '#a8a29e' : 'none'"
        stroke-width="1"
      />
      <g v-if="isLastMove(stone)" :transform="`translate(${pos(stone.x)}, ${pos(stone.y)})`">
        <g
          :stroke="stone.cell === 'black' ? '#1c1917' : '#ffffff'"
          stroke-width="2.5"
          stroke-linecap="round"
          fill="none"
          class="origin-center animate-[mark-pop_0.25s_ease-out] [transform-box:fill-box]"
        >
          <use href="#corner-mark" />
        </g>
      </g>
    </g>

    <g v-for="p in forbidden" :key="`f${p.x},${p.y}`" :transform="`translate(${pos(p.x)}, ${pos(p.y)})`">
      <g
        stroke="#ef4444"
        stroke-linecap="round"
        class="origin-center animate-[mark-pop_0.25s_ease-out] [transform-box:fill-box]"
      >
        <circle :r="FORBID_R" fill="#ef4444" fill-opacity="0.32" stroke-width="2.5" />
        <line :x1="-FORBID_R * 0.45" :y1="-FORBID_R * 0.45" :x2="FORBID_R * 0.45" :y2="FORBID_R * 0.45" stroke-width="3" />
        <line :x1="-FORBID_R * 0.45" :y1="FORBID_R * 0.45" :x2="FORBID_R * 0.45" :y2="-FORBID_R * 0.45" stroke-width="3" />
      </g>
      <g
        v-if="isLastMove(p)"
        stroke="#ef4444"
        stroke-width="2.5"
        stroke-linecap="round"
        fill="none"
        class="origin-center animate-[mark-pop_0.25s_ease-out] [transform-box:fill-box]"
      >
        <use href="#corner-mark" />
      </g>
    </g>

    <g v-for="v in vanishStones" :key="`v${v.x},${v.y}`" :transform="`translate(${pos(v.x)}, ${pos(v.y)})`">
      <g
        :style="{ animationDelay: `${v.delay}ms` }"
        class="origin-center animate-[vanish_0.3s_ease-in_both] [transform-box:fill-box]"
      >
        <template v-if="v.cell === 'black' || v.cell === 'white'">
          <circle
            :r="STONE_R"
            :fill="`url(#stone-${v.cell})`"
            :stroke="v.cell === 'white' ? '#a8a29e' : 'none'"
            stroke-width="1"
          />
        </template>
        <template v-else-if="v.cell === 'forbidden'">
          <g stroke="#ef4444" stroke-linecap="round">
            <circle :r="FORBID_R" fill="#ef4444" fill-opacity="0.32" stroke-width="2.5" />
            <line :x1="-FORBID_R * 0.45" :y1="-FORBID_R * 0.45" :x2="FORBID_R * 0.45" :y2="FORBID_R * 0.45" stroke-width="3" />
            <line :x1="-FORBID_R * 0.45" :y1="FORBID_R * 0.45" :x2="FORBID_R * 0.45" :y2="-FORBID_R * 0.45" stroke-width="3" />
          </g>
        </template>
      </g>
    </g>

    <line
      v-for="ray in rays"
      :key="`ray${ray.key}`"
      :x1="pos(ray.from.x)"
      :y1="pos(ray.from.y)"
      :x2="pos(ray.to.x)"
      :y2="pos(ray.to.y)"
      pathLength="1"
      stroke="#fbbf24"
      stroke-width="7"
      stroke-linecap="round"
      stroke-dasharray="1"
      class="animate-[ray_0.5s_ease-out_forwards]"
    />

    <line
      v-for="(line, i) in state.winningLines"
      :key="`win${i}`"
      :x1="pos(line[0].x)"
      :y1="pos(line[0].y)"
      :x2="pos(line[line.length - 1].x)"
      :y2="pos(line[line.length - 1].y)"
      pathLength="1"
      stroke="#fbbf24"
      stroke-width="7"
      stroke-linecap="round"
      stroke-dasharray="1"
      opacity="0.9"
      class="animate-[win-line_0.5s_ease-out_forwards]"
    />

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
        :stroke="seat === 'black' ? '#1c1917' : '#ffffff'"
        stroke-width="2.5"
        :class="!submitted && 'animate-[breathe_1.6s_ease-in-out_infinite]'"
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
