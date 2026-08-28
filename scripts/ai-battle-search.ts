import { chooseImmediateWinningMove } from '../src/engine/ai.ts'
import { type GameState, type Point, type Seat } from '../src/engine/game.ts'
import { ductSearch } from '../src/engine/mcts/duct.ts'
import { rmSearch } from '../src/engine/mcts/rm.ts'

export type SideConfig =
  | { policy: 'duct'; candidates: number; explore: number; budgetMs: number }
  | { policy: 'rm'; candidates: number; budgetMs: number }

// 与引擎 searchBestMove 的逐策略行为一致：rm 先吃必胜手再搜索，duct 直接搜索。
export function searchSideMove(state: GameState, seat: Seat, side: SideConfig): Point | null {
  if (side.policy === 'rm') {
    const winningMove = chooseImmediateWinningMove(state, seat)
    if (winningMove) return winningMove
    return rmSearch(state, seat, side.candidates, side.budgetMs)
  }
  return ductSearch(state, seat, side.candidates, side.explore, side.budgetMs)
}
