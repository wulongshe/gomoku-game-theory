import { settleFrame, type GameState, type Point, type Seat } from './game'
import { analyzeBoard, evaluateState, sampleIndex } from './eval'

export type Difficulty = 'easy' | 'normal' | 'hard' | 'master'

// 节点策略：duct 解耦 UCB（贪最强手、可被针对）；rm 遗憾匹配（平均策略收敛混合纳什、不可被利用）。
export type AiPolicy = 'duct' | 'rm'

// explore：均衡分布里混入均匀探索的比例（越高越随机越弱）；budgetMs：SM-MCTS 时间盒（毫秒）。
export const DIFFICULTY_SETTINGS: Record<
  Difficulty,
  { candidates: number; explore: number; budgetMs: number; policy: AiPolicy }
> = {
  easy: { candidates: 5, explore: 0.55, budgetMs: 200, policy: 'duct' },
  normal: { candidates: 6, explore: 0.22, budgetMs: 450, policy: 'duct' },
  hard: { candidates: 7, explore: 0, budgetMs: 800, policy: 'duct' },
  master: { candidates: 7, explore: 0, budgetMs: 1200, policy: 'rm' },
}

const FICTITIOUS_ITERATIONS = 300

// 「AI 下 ai、对手下 opp」这一格的收益（AI 视角）。抢点撞同点时先手随机，取两种先手的均值。
function payoff(state: GameState, seat: Seat, ai: Point, opp: Point): number {
  const choices =
    seat === 'black' ? { black: ai, white: opp } : { black: opp, white: ai }
  if (state.mode === 'race' && ai.x === opp.x && ai.y === opp.y) {
    return (
      (evaluateState(settleFrame(state, { ...choices, first: 'black' }), seat) +
        evaluateState(settleFrame(state, { ...choices, first: 'white' }), seat)) /
      2
    )
  }
  return evaluateState(settleFrame(state, choices), seat)
}

// 虚拟对弈（fictitious play）求解零和博弈：双方反复对当前经验分布做最优回应，
// 行方（AI）的经验频率即收敛到极大极小混合策略。
function solveMaximin(matrix: number[][]): number[] {
  const rows = matrix.length
  const cols = matrix[0].length
  const rowCount = new Array(rows).fill(0)
  const colCount = new Array(cols).fill(0)
  for (let t = 0; t < FICTITIOUS_ITERATIONS; t++) {
    let bestRow = 0
    let bestRowValue = -Infinity
    for (let i = 0; i < rows; i++) {
      let v = 0
      for (let j = 0; j < cols; j++) v += colCount[j] * matrix[i][j]
      if (v > bestRowValue) {
        bestRowValue = v
        bestRow = i
      }
    }
    rowCount[bestRow]++
    let bestCol = 0
    let bestColValue = Infinity
    for (let j = 0; j < cols; j++) {
      let v = 0
      for (let i = 0; i < rows; i++) v += rowCount[i] * matrix[i][j]
      if (v < bestColValue) {
        bestColValue = v
        bestCol = j
      }
    }
    colCount[bestCol]++
  }
  return rowCount.map((c) => c / FICTITIOUS_ITERATIONS)
}

// 第三层：top-K 收益矩阵 → 虚拟对弈极大极小混合策略 → 采样；也作为无 Worker 时 MCTS 的同步兜底。
export function chooseAiMove(
  state: GameState,
  seat: Seat,
  difficulty: Difficulty = 'normal',
): Point | null {
  const { candidates, explore } = DIFFICULTY_SETTINGS[difficulty]
  const { aiMoves, oppMoves } = analyzeBoard(state, seat, candidates)
  if (aiMoves.length <= 1) return aiMoves[0] ?? null

  const matrix = aiMoves.map((ai) => oppMoves.map((opp) => payoff(state, seat, ai, opp)))
  const equilibrium = solveMaximin(matrix)
  const n = aiMoves.length
  const dist = equilibrium.map((p) => (1 - explore) * p + explore / n)
  return aiMoves[sampleIndex(dist)]
}
