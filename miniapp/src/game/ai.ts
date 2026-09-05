import { searchBestMove } from '@gomoku/engine/mcts'
import type { Difficulty } from '@gomoku/engine/ai'
import type { GameState, Point } from '@gomoku/engine/game'

// 按难度记录上一手实际迭代数（迭代数与该难度的时间盒绑定，不可跨难度比较），
// 供引擎做宽窄候选自适应；小程序跑在手机上，master 通常会稳定落在窄候选档。
const lastIterations: Partial<Record<Difficulty, number>> = {}

// AI 固定执白，按帧初局面独立搜索。
export function aiMove(state: GameState, difficulty: Difficulty): Point | null {
  const { point, iterations } = searchBestMove(
    state,
    'white',
    difficulty,
    undefined,
    lastIterations[difficulty],
  )
  if (iterations > 0) lastIterations[difficulty] = iterations
  return point
}
