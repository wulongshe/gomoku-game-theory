import { type GameState, type Point, type Seat } from '../../src/engine/game'
import { ductSearch } from '../../src/engine/mcts/duct'
import { rmSearch } from '../../src/engine/mcts/rm'
import { DEFAULT_BLOCK_RATE } from '../../src/engine/opponent'

export type SideConfig =
  | { policy: 'duct'; candidates: number; explore: number; budgetMs: number }
  | { policy: 'rm'; candidates: number; budgetMs: number }

// 与引擎 searchBestMove 的逐策略行为一致：duct 走 DUCT，rm 走遗憾匹配（blockRate 为对手封堵率观测，仅 rm 用）。
export function searchSideMove(
  state: GameState,
  seat: Seat,
  side: SideConfig,
  blockRate: number = DEFAULT_BLOCK_RATE,
): Point | null {
  if (side.policy === 'rm') return rmSearch(state, seat, side.candidates, side.budgetMs, blockRate)
  return ductSearch(state, seat, side.candidates, side.explore, side.budgetMs)
}
