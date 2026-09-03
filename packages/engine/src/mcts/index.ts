import { type GameState, type Point, type Seat } from '../game'
import { DIFFICULTY_SETTINGS, type Difficulty } from '../ai'
import { ductSearch } from './duct'

// SM-MCTS：解耦 UCB 逐帧向前搜，anytime + 时间盒。budgetMs 可覆盖难度默认时间盒。
export function searchBestMove(
  state: GameState,
  seat: Seat,
  difficulty: Difficulty = 'normal',
  budgetMs?: number,
): Point | null {
  const settings = DIFFICULTY_SETTINGS[difficulty]
  const budget = budgetMs ?? settings.budgetMs
  return ductSearch(state, seat, settings.candidates, settings.explore, budget)
}
