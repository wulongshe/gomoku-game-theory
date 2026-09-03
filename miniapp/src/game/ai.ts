import { searchBestMove } from '@gomoku/engine/mcts'
import type { Difficulty } from '@gomoku/engine/ai'
import type { GameState, Point } from '@gomoku/engine/game'

// AI 固定执白，按帧初局面独立搜索。
export function aiMove(state: GameState, difficulty: Difficulty): Point | null {
  return searchBestMove(state, 'white', difficulty)
}
