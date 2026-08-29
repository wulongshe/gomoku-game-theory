import { type GameState, type Point, type Seat } from '../game'
import { analyzeBoard, evaluateState, normalize } from '../eval'
import { quiescenceValue, type QuiescenceOptions } from '../quiescence'

export const MAX_ITERATIONS = 60_000
// 递归深度上限：常规下棋盘单调填满、深度天然有界，唯「双方同帧成五湮灭清子」会破坏单调，硬顶防爆栈。
export const MAX_DEPTH = 300

// 搜索可选项（两种策略共用）：quiescence 开启同时博弈静止评估叶子；maxIterations 覆盖迭代上限（大预算吃满时间）。
export interface SearchOptions {
  quiescence?: QuiescenceOptions
  maxIterations?: number
}

// 节点静态部分（两种策略共用）：双方候选、首展评估值、是否可再展开（两侧都有候选）。
export interface Core {
  state: GameState
  aiMoves: Point[]
  oppMoves: Point[]
  value0: number
  expandable: boolean
}

export function expand(state: GameState, seat: Seat, candidates: number, opts?: SearchOptions): Core {
  if (state.phase !== 'playing') {
    return { state, aiMoves: [], oppMoves: [], value0: normalize(evaluateState(state, seat)), expandable: false }
  }
  const { aiMoves, oppMoves, threatSelf, threatOpp } = analyzeBoard(state, seat, candidates)
  const value0 = opts?.quiescence
    ? quiescenceValue(state, seat, opts.quiescence)
    : normalize(threatSelf - threatOpp)
  return {
    state,
    aiMoves,
    oppMoves,
    value0,
    expandable: aiMoves.length > 0 && oppMoves.length > 0,
  }
}
