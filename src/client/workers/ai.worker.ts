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

// 按难度记录上一手实际迭代数（迭代数与该难度的时间盒绑定，不可跨难度比较），
// 供引擎做宽窄候选自适应；0 表示唯一手直接返回，不更新水位。
const lastIterations: Partial<Record<Difficulty, number>> = {}

ctx.onmessage = ({ data }) => {
  const { point, iterations } = searchBestMove(
    data.state,
    data.seat,
    data.difficulty,
    undefined,
    lastIterations[data.difficulty],
  )
  if (iterations > 0) lastIterations[data.difficulty] = iterations
  ctx.postMessage({ id: data.id, move: point })
}
