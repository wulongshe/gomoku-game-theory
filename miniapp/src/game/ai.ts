import { prepareSearch } from '@gomoku/engine/mcts'
import type { Difficulty } from '@gomoku/engine/ai'
import type { GameState, Point } from '@gomoku/engine/game'

// 小程序没有 Worker：把 SM-MCTS 切成小片穿插在主线程里跑，从回合一开始就与人同时思考。
// 每片约 SLICE_MS，片间让出主线程，UI 保持可响应；人提交后仍跑满时间盒，保证各难度实力稳定。
const SLICE_MS = 40

// 按难度记录上一手实际迭代数（迭代数与该难度的时间盒绑定，不可跨难度比较），
// 供引擎做宽窄候选自适应；手机上 master 通常会稳定落在窄候选档。
const lastIterations: Partial<Record<Difficulty, number>> = {}

// 只带引擎会读的字段，得到纯数据快照，避免搜索全程穿过 Vue 响应式代理。
function snapshot(state: GameState): GameState {
  return {
    board: [...state.board],
    phase: state.phase,
    frame: state.frame,
    cleared: [],
    lastMoves: [],
    winningLines: [],
  }
}

export interface AiJob {
  move: Promise<Point | null>
  cancel(): void
}

// AI 固定执白，按帧初局面独立搜索。
export function startAiMove(state: GameState, difficulty: Difficulty): AiJob {
  const search = prepareSearch(snapshot(state), 'white', difficulty, lastIterations[difficulty])
  let remaining = search.budgetMs
  let timer: ReturnType<typeof setTimeout> | undefined

  const move = new Promise<Point | null>((resolve) => {
    function finish(): void {
      const { point, iterations } = search.result()
      if (iterations > 0) lastIterations[difficulty] = iterations
      resolve(point)
    }
    function step(): void {
      const started = performance.now()
      const done = search.run(Math.min(SLICE_MS, remaining))
      remaining -= performance.now() - started
      if (done || remaining <= 0) finish()
      else timer = setTimeout(step, 0)
    }
    step()
  })

  return {
    move,
    cancel() {
      clearTimeout(timer)
    },
  }
}
