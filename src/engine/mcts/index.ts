import { type GameState, type Point, type Seat } from '../game.ts'
import { chooseImmediateWinningMove, DIFFICULTY_SETTINGS, type Difficulty } from '../ai.ts'
import { ductSearch } from './duct.ts'
import { rmSearch } from './rm.ts'

// SM-MCTS：解耦 UCB 逐帧向前搜，anytime + 时间盒；节点策略按难度选 DUCT（第四层）或遗憾匹配（第五层）。
// budgetMs 可覆盖难度默认时间盒。
export function searchBestMove(
  state: GameState,
  seat: Seat,
  difficulty: Difficulty = 'normal',
  budgetMs?: number,
): Point | null {
  const settings = DIFFICULTY_SETTINGS[difficulty]
  if (settings.policy === 'rm') {
    const winningMove = chooseImmediateWinningMove(state, seat)
    if (winningMove) return winningMove
  }

  const budget = budgetMs ?? settings.budgetMs
  return settings.policy === 'rm'
    ? rmSearch(state, seat, settings.candidates, budget)
    : ductSearch(state, seat, settings.candidates, settings.explore, budget)
}
