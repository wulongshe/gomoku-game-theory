import { type GameState, type Point, type Seat } from '../game'
import { DIFFICULTY_SETTINGS, type Difficulty } from '../ai'
import { type SearchOptions } from './core'
import { ductSearch } from './duct'
import { rmSearch } from './rm'

// SM-MCTS：解耦 UCB 逐帧向前搜，anytime + 时间盒；节点策略按难度选 DUCT（第四层）或遗憾匹配（第五层）。
// budgetMs 可覆盖难度默认时间盒；opts 可覆盖静止评估/迭代上限（缺省时取难度自带的 quiescence 配置）。
export function searchBestMove(
  state: GameState,
  seat: Seat,
  difficulty: Difficulty = 'normal',
  budgetMs?: number,
  opts?: SearchOptions,
): Point | null {
  const settings = DIFFICULTY_SETTINGS[difficulty]
  const budget = budgetMs ?? settings.budgetMs
  const options = opts ?? (settings.quiescence ? { quiescence: settings.quiescence } : undefined)
  return settings.policy === 'rm'
    ? rmSearch(state, seat, settings.candidates, budget, options)
    : ductSearch(state, seat, settings.candidates, settings.explore, budget, options)
}
