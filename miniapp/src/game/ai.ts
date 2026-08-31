import { searchBestMove } from '@gomoku/engine/mcts'
import type { Difficulty } from '@gomoku/engine/ai'
import type { GameState, Point } from '@gomoku/engine/game'

// AI 固定执白。地狱难度传入对手落点与读心置信度 read（0 纯盲搜～0.95 near-full read）；
// 其余难度 oppMove/read 缺省，按帧初局面独立搜索。
export function aiMove(
  state: GameState,
  difficulty: Difficulty,
  oppMove: Point | null = null,
  read = 0,
): Point | null {
  return searchBestMove(state, 'white', difficulty, undefined, oppMove, read)
}
