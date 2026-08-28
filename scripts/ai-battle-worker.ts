import { parentPort } from 'node:worker_threads'
import { type GameState, type Seat } from '../src/engine/game.ts'
import { searchSideMove, type SideConfig } from './ai-battle-search.ts'

interface SearchRequest {
  id: number
  state: GameState
  seat: Seat
  side: SideConfig
}

parentPort!.on('message', ({ id, state, seat, side }: SearchRequest) => {
  parentPort!.postMessage({ id, move: searchSideMove(state, seat, side) })
})
