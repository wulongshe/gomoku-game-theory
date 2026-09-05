import { type GameState, type Seat } from '../game'
import { DIFFICULTY_SETTINGS, type Difficulty } from '../ai'
import { ductSearch, type SearchResult } from './duct'

export type { SearchResult }

// SM-MCTS：解耦 UCB 逐帧向前搜，anytime + 时间盒。budgetMs 可覆盖难度默认时间盒。
// prevIterations 传上一手实际迭代数：低于难度配置的 fallback.minIterations（慢设备吃不饱
// 宽候选的访问密度）时自动改用窄候选。
export function searchBestMove(
  state: GameState,
  seat: Seat,
  difficulty: Difficulty = 'normal',
  budgetMs?: number,
  prevIterations?: number,
): SearchResult {
  const settings = DIFFICULTY_SETTINGS[difficulty]
  const { fallback } = settings
  const candidates =
    fallback && prevIterations !== undefined && prevIterations < fallback.minIterations
      ? fallback.candidates
      : settings.candidates
  return ductSearch(state, seat, candidates, settings.explore, budgetMs ?? settings.budgetMs)
}
