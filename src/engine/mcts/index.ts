import { type GameState, type Point, type Seat } from '../game'
import { DIFFICULTY_SETTINGS, type Difficulty } from '../ai'
import { ductSearch } from './duct'
import { rmSearch } from './rm'

// SM-MCTS：解耦 UCB 逐帧向前搜，anytime + 时间盒；节点策略按难度选 DUCT（第四层）或遗憾匹配（第五层）。
// budgetMs 可覆盖难度默认时间盒；opponentRationality 为观察到的对手理性程度（默认 1 = 完全理性）。
export function searchBestMove(
  state: GameState,
  seat: Seat,
  difficulty: Difficulty = 'normal',
  budgetMs?: number,
  opponentRationality = 1,
): Point | null {
  const settings = DIFFICULTY_SETTINGS[difficulty]
  const budget = budgetMs ?? settings.budgetMs
  return settings.policy === 'rm'
    ? rmSearch(state, seat, settings.candidates, budget, opponentRationality)
    : ductSearch(state, seat, settings.candidates, settings.explore, budget, opponentRationality)
}
