import { searchBestMove } from '@gomoku/engine/mcts'
import type { Difficulty } from '@gomoku/engine/ai'
import type { GameState, Point, Seat } from '@gomoku/engine/game'

interface AiRequest {
  id: number
  state: GameState
  seat: Seat
  difficulty: Difficulty
}

interface AiResponse {
  id: number
  move: Point | null
}

const ctx = self as unknown as {
  onmessage: ((event: MessageEvent<AiRequest>) => void) | null
  postMessage: (message: AiResponse) => void
}

ctx.onmessage = ({ data }) => {
  const move = searchBestMove(data.state, data.seat, data.difficulty)
  ctx.postMessage({ id: data.id, move })
}
