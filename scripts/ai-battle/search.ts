import { type GameState, type Point, type Seat } from '../../packages/engine/src/game'
import { ductSearch } from '../../packages/engine/src/mcts/duct'

export interface SideConfig {
  candidates: number
  explore: number
  budgetMs: number
}

// 与引擎行为一致，走 DUCT。
export function searchSideMove(state: GameState, seat: Seat, side: SideConfig): Point | null {
  return ductSearch(state, seat, side.candidates, side.explore, side.budgetMs)
}
