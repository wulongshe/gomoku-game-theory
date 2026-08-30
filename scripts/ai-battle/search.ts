import { type GameState, type Point, type Seat } from '../../src/engine/game'
import { ductSearch } from '../../src/engine/mcts/duct'
import { rmSearch } from '../../src/engine/mcts/rm'

export type SideConfig =
  | { policy: 'duct'; candidates: number; explore: number; budgetMs: number }
  | { policy: 'rm'; candidates: number; budgetMs: number }
  | { policy: 'respond'; candidates: number; explore: number; budgetMs: number; read?: number }

// 与引擎行为一致：duct 走 DUCT，rm 走遗憾匹配，respond 走「已知对手本帧手」的读心 DUCT 应手（在 root 以概率 read
// 押注对手真实点、其余对抗性探索；需由调用方在算完对手手后把它作为 oppMove 传入；对手无手时退化为盲搜）。
export function searchSideMove(
  state: GameState,
  seat: Seat,
  side: SideConfig,
  oppMove: Point | null = null,
): Point | null {
  if (side.policy === 'rm') return rmSearch(state, seat, side.candidates, side.budgetMs)
  if (side.policy === 'respond') {
    return ductSearch(state, seat, side.candidates, side.explore, side.budgetMs, oppMove, side.read ?? 1)
  }
  return ductSearch(state, seat, side.candidates, side.explore, side.budgetMs)
}
