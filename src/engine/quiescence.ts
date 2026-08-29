import { settleFrame, type GameState, type Point, type Seat } from './game'
import {
  analyzeBoard,
  evaluateState,
  joint,
  matrixSecurityValue,
  normalize,
  solveMaximin,
} from './eval'

// candidates：每方战术着法宽度（矩阵维度）；maxDepth：战术前瞻层数。
export interface QuiescenceOptions {
  candidates: number
  maxDepth: number
}

// 「响」局面阈值：任一方达到单端冲四及以上（threatValue ≥ 15000）才展开静止搜索；活三及以下按静止直接静态评估。
const LOUD_THRESHOLD = 15_000

// 同时落子的静止（quiescence）评估：在「响」局面（任一方有胜点/冲四）上，只在战术候选（胜点/冲四/活三的攻防点）
// 上做小型同时矩阵博弈，逐层递归到静止或深度上限回退静态评估，全程在归一化 [-1,1] 空间。忠于同时规则：
// 「叉」是猜点博弈，矩阵解自然给出其真实混合价值（≈(k-1)/k），不会把单威胁误判为必胜。
export function quiescenceValue(state: GameState, seat: Seat, opts: QuiescenceOptions): number {
  return quiesce(state, seat, 0, opts)
}

function quiesce(state: GameState, seat: Seat, depth: number, opts: QuiescenceOptions): number {
  if (state.phase !== 'playing') return normalize(evaluateState(state, seat))
  const { aiMoves, oppMoves, threatSelf, threatOpp } = analyzeBoard(state, seat, opts.candidates)
  const staticValue = normalize(threatSelf - threatOpp)
  const loud = Math.max(threatSelf, threatOpp) >= LOUD_THRESHOLD
  if (!loud || depth >= opts.maxDepth || aiMoves.length === 0 || oppMoves.length === 0) {
    return staticValue
  }
  const matrix = aiMoves.map((ai) =>
    oppMoves.map((opp) => jointValue(state, seat, ai, opp, depth, opts)),
  )
  return matrixSecurityValue(matrix, solveMaximin(matrix))
}

// 一格联合着法的（seat 视角、归一化）价值；抢点撞同点先手随机 → 两种先手递归取均值（与静态评估口径一致）。
function jointValue(
  state: GameState,
  seat: Seat,
  ai: Point,
  opp: Point,
  depth: number,
  opts: QuiescenceOptions,
): number {
  if (state.mode === 'race' && ai.x === opp.x && ai.y === opp.y) {
    const choices = joint(seat, ai, opp)
    const asBlack = settleFrame(state, { ...choices, first: 'black' })
    const asWhite = settleFrame(state, { ...choices, first: 'white' })
    return (quiesce(asBlack, seat, depth + 1, opts) + quiesce(asWhite, seat, depth + 1, opts)) / 2
  }
  return quiesce(settleFrame(state, joint(seat, ai, opp)), seat, depth + 1, opts)
}
