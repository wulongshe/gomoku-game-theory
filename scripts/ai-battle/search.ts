import { type GameState, type Point, type Seat } from '../../src/engine/game'
import { ductSearch } from '../../src/engine/mcts/duct'
import { rmSearch } from '../../src/engine/mcts/rm'

export type SideConfig =
  | { policy: 'duct'; candidates: number; explore: number; budgetMs: number }
  | { policy: 'rm'; candidates: number; budgetMs: number }
  | { policy: 'respond'; candidates: number; explore: number; budgetMs: number; slip?: number }

// 与引擎行为一致：duct 走 DUCT，rm 走遗憾匹配，respond 走「已知对手本帧手」的 DUCT 应手（根固定对手手，
// 需由调用方在算完对手手后把它作为 oppMove 传入；对手无手时退化为盲搜）。
export function searchSideMove(
  state: GameState,
  seat: Seat,
  side: SideConfig,
  oppMove: Point | null = null,
): Point | null {
  if (side.policy === 'rm') return rmSearch(state, seat, side.candidates, side.budgetMs)
  if (side.policy === 'respond') {
    const blind = side.slip ? Math.random() < side.slip : false
    return ductSearch(state, seat, side.candidates, side.explore, side.budgetMs, blind ? null : oppMove)
  }
  return ductSearch(state, seat, side.candidates, side.explore, side.budgetMs)
}
