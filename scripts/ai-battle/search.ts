import { type GameState, type Point, type Seat } from '../../src/engine/game'
import { ductSearch } from '../../src/engine/mcts/duct'
import { rmSearch } from '../../src/engine/mcts/rm'

export type SideConfig =
  | { policy: 'duct'; candidates: number; explore: number; budgetMs: number }
  | { policy: 'rm'; candidates: number; budgetMs: number }

// 与引擎 searchBestMove 的逐策略行为一致：duct 走 DUCT，rm 走遗憾匹配。
export function searchSideMove(state: GameState, seat: Seat, side: SideConfig): Point | null {
  if (side.policy === 'rm') return rmSearch(state, seat, side.candidates, side.budgetMs)
  return ductSearch(state, seat, side.candidates, side.explore, side.budgetMs)
}
