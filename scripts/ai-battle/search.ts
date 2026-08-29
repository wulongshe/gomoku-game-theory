import { type GameState, type Point, type Seat } from '../../src/engine/game'
import { type SearchOptions } from '../../src/engine/mcts/core'
import { ductSearch } from '../../src/engine/mcts/duct'
import { rmSearch } from '../../src/engine/mcts/rm'
import { type QuiescenceOptions } from '../../src/engine/quiescence'

export type SideConfig =
  | { policy: 'duct'; candidates: number; explore: number; budgetMs: number; quiescence?: QuiescenceOptions }
  | { policy: 'rm'; candidates: number; budgetMs: number; quiescence?: QuiescenceOptions }

// 放开引擎默认 60k 迭代上限，让墙钟预算成为唯一约束（吃满 30s+）；每节点存一份棋盘快照，
// 大预算 × 高并行会吃内存，必要时调小 main.ts 的 PARALLEL_ROUNDS 或 budgetMs。
const MAX_SEARCH_ITERATIONS = 300_000

// 与引擎 searchBestMove 的逐策略行为一致：duct 走 DUCT，rm 走遗憾匹配；quiescence 开启同时博弈静止评估。
export function searchSideMove(state: GameState, seat: Seat, side: SideConfig): Point | null {
  const opts: SearchOptions = { quiescence: side.quiescence, maxIterations: MAX_SEARCH_ITERATIONS }
  if (side.policy === 'rm') return rmSearch(state, seat, side.candidates, side.budgetMs, opts)
  return ductSearch(state, seat, side.candidates, side.explore, side.budgetMs, opts)
}
