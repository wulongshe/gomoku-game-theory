<script setup lang="ts">
import { computed } from 'vue'
import { BOARD_SIZE, type CellState, type GameState, type Point, type Seat } from '@/engine/game'

const props = defineProps<{
  state: GameState
  seat: Seat
  selected: Point | null
  interactive: boolean
}>()

const emit = defineEmits<{ select: [point: Point] }>()

interface Cell {
  x: number
  y: number
  state: CellState
  isSelected: boolean
}

const cells = computed<Cell[]>(() =>
  props.state.board.map((state, i) => {
    const x = i % BOARD_SIZE
    const y = Math.floor(i / BOARD_SIZE)
    return {
      x,
      y,
      state,
      isSelected: props.selected?.x === x && props.selected?.y === y,
    }
  }),
)
</script>

<template>
  <div
    class="grid w-full max-w-md gap-px rounded border border-stone-400 bg-stone-400 p-px"
    :style="{ gridTemplateColumns: `repeat(${BOARD_SIZE}, minmax(0, 1fr))` }"
  >
    <button
      v-for="cell in cells"
      :key="`${cell.x},${cell.y}`"
      class="relative aspect-square touch-manipulation bg-amber-50"
      :disabled="!interactive || cell.state !== 'empty'"
      @click="emit('select', { x: cell.x, y: cell.y })"
    >
      <span v-if="cell.state === 'p1'" class="absolute inset-[10%] rounded-full bg-stone-900" />
      <span
        v-else-if="cell.state === 'p2'"
        class="absolute inset-[10%] rounded-full border border-stone-400 bg-white"
      />
      <span
        v-else-if="cell.state === 'forbidden'"
        class="absolute inset-0 flex items-center justify-center text-xs font-bold text-red-500"
      >
        ✕
      </span>
      <span
        v-else-if="cell.isSelected"
        class="absolute inset-[10%] rounded-full opacity-60"
        :class="seat === 'p1' ? 'bg-stone-900' : 'border border-stone-400 bg-white'"
      />
    </button>
  </div>
</template>
