import { type FrameChoices, type GameState, type Point, type Seat } from '../game'
import { analyzeBoard, evaluateState, MAX_THREAT_VALUE, TERMINAL } from '../eval'

// 对战实测：K=14 需 ~120k 迭代才够摊满 K² 联合格的访问密度；低难度受时间盒约束，远触不到这道闸。
export const MAX_ITERATIONS = 120_000
// 递归深度上限：常规下棋盘单调填满、深度天然有界，唯「双方同帧成五湮灭清子」会破坏单调，硬顶防爆栈。
export const MAX_DEPTH = 300
// 非终局威胁差的量级上限（含多胜点重奖），保证多威胁不被对数归一挤到与单威胁齐平。
const HEURISTIC_LOG = Math.log1p(MAX_THREAT_VALUE)

// 归一化到 [-1,1]：终局 ±1；非终局按 |值| 对数映射到 ±0.95，全量级保留梯度（tanh 会在冲四以上饱和，弃用）。
function normalize(raw: number): number {
  if (raw >= TERMINAL / 2) return 1
  if (raw <= -TERMINAL / 2) return -1
  const mag = Math.min(1, Math.log1p(Math.abs(raw)) / HEURISTIC_LOG) * 0.95
  return raw < 0 ? -mag : mag
}

// 联合动作 (AI, 对手) 落到帧提交结构；AI 执哪一色由 seat 决定。
export function joint(seat: Seat, ai: Point, opp: Point): FrameChoices {
  return seat === 'black' ? { black: ai, white: opp } : { black: opp, white: ai }
}

// 节点静态部分：双方候选、首展评估值、是否可再展开（两侧都有候选）。
export interface Core {
  state: GameState
  aiMoves: Point[]
  oppMoves: Point[]
  value0: number
  expandable: boolean
}

export function expand(state: GameState, seat: Seat, candidates: number): Core {
  if (state.phase !== 'playing') {
    return { state, aiMoves: [], oppMoves: [], value0: normalize(evaluateState(state, seat)), expandable: false }
  }
  const { aiMoves, oppMoves, threatSelf, threatOpp } = analyzeBoard(state, seat, candidates)
  return {
    state,
    aiMoves,
    oppMoves,
    value0: normalize(threatSelf - threatOpp),
    expandable: aiMoves.length > 0 && oppMoves.length > 0,
  }
}
