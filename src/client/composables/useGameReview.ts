import { computed, ref } from 'vue'
import type { GameState } from '@gomoku/engine/game'

// 终局回看：缓存每个已结算回合的局面（不含开局空盘），结束后逐回合前后翻看。
export function useGameReview() {
  const history = ref<GameState[]>([])
  const index = ref<number | null>(null) // null = 停在最新一帧

  const state = computed(() =>
    index.value === null ? null : (history.value[index.value] ?? null),
  )
  const atFirst = computed(() => (index.value ?? history.value.length - 1) <= 0)
  const atLatest = computed(() => index.value === null)
  const available = computed(() => history.value.length > 1)

  function record(frame: GameState) {
    history.value.push(frame)
    index.value = null
  }

  function reset(initial?: GameState) {
    history.value = initial ? [initial] : []
    index.value = null
  }

  function step(delta: number) {
    const last = history.value.length - 1
    if (last < 0) return
    const next = Math.min(last, Math.max(0, (index.value ?? last) + delta))
    index.value = next === last ? null : next
  }

  return { state, atFirst, atLatest, available, record, reset, step }
}
