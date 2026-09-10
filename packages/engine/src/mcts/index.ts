import { type GameState, type Seat } from '../game'
import { DIFFICULTY_SETTINGS, type Difficulty } from '../ai'
import { createDuctSearch, type DuctSearch, type SearchResult } from './duct'

export type { DuctSearch, SearchResult }

export interface PreparedSearch extends DuctSearch {
  // 该难度的默认时间盒（毫秒），分片调用方按它累计 run 的耗时。
  budgetMs: number
}

// SM-MCTS：解耦 UCB 逐帧向前搜，anytime + 时间盒。prevIterations 传上一手实际迭代数：
// 低于难度配置的 fallback.minIterations（慢设备吃不饱宽候选的访问密度）时自动改用窄候选。
export function prepareSearch(
  state: GameState,
  seat: Seat,
  difficulty: Difficulty = 'normal',
  prevIterations?: number,
): PreparedSearch {
  const settings = DIFFICULTY_SETTINGS[difficulty]
  const { fallback } = settings
  const candidates =
    fallback && prevIterations !== undefined && prevIterations < fallback.minIterations
      ? fallback.candidates
      : settings.candidates
  return {
    ...createDuctSearch(state, seat, candidates, settings.explore),
    budgetMs: settings.budgetMs,
  }
}

// 一次跑满时间盒（budgetMs 可覆盖难度默认）。
export function searchBestMove(
  state: GameState,
  seat: Seat,
  difficulty: Difficulty = 'normal',
  budgetMs?: number,
  prevIterations?: number,
): SearchResult {
  const search = prepareSearch(state, seat, difficulty, prevIterations)
  search.run(budgetMs ?? search.budgetMs)
  return search.result()
}
