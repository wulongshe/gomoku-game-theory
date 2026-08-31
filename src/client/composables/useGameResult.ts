import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import type { GameState, Seat } from '@gomoku/engine/game'

// 从对局阶段与本方 seat 推导结果展示：艺术字 char、渐变色 colors、文字色 textCls。
// 未分胜负（进行中 / 和棋）时按和棋样式。
export function useGameResult(
  game: MaybeRefOrGetter<GameState | null>,
  seat: MaybeRefOrGetter<Seat>,
) {
  const winnerSeat = computed<Seat | null>(() => {
    const phase = toValue(game)?.phase
    if (phase === 'black_won') return 'black'
    if (phase === 'white_won') return 'white'
    return null
  })
  const won = computed(() => winnerSeat.value !== null && winnerSeat.value === toValue(seat))

  const char = computed(() => (winnerSeat.value === null ? '和' : won.value ? '赢' : '输'))
  const colors = computed(() =>
    winnerSeat.value === null
      ? ['#ffffff', '#d6d3d1']
      : won.value
        ? ['#fbbf24', '#d97706']
        : ['#a8a29e', '#57534e'],
  )
  const textCls = computed(() =>
    winnerSeat.value === null
      ? 'text-white drop-shadow-[0_1px_1px_rgba(28,25,23,0.45)]'
      : won.value
        ? 'text-amber-500 dark:text-amber-400'
        : 'text-stone-400 dark:text-stone-500',
  )

  return { char, colors, textCls }
}
