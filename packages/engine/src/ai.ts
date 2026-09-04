import { settleFrame, type GameState, type Point, type Seat } from './game'
import { analyzeBoard, evaluateState, sampleIndex, WIN_SCORE } from './eval'

export type Difficulty = 'easy' | 'normal' | 'hard' | 'master'

// explore：均衡分布里混入均匀探索的比例（越高越随机越弱）；budgetMs：SM-MCTS 时间盒（毫秒）。
export const DIFFICULTY_SETTINGS: Record<
  Difficulty,
  { candidates: number; explore: number; budgetMs: number }
> = {
  easy: { candidates: 5, explore: 0.55, budgetMs: 200 },
  normal: { candidates: 6, explore: 0.22, budgetMs: 450 },
  hard: { candidates: 7, explore: 0, budgetMs: 800 },
  master: { candidates: 10, explore: 0, budgetMs: 6400 },
}

const FICTITIOUS_ITERATIONS = 300

// 「AI 下 ai、对手下 opp」这一格的收益（AI 视角）。
function payoff(state: GameState, seat: Seat, ai: Point, opp: Point): number {
  const choices = seat === 'black' ? { black: ai, white: opp } : { black: opp, white: ai }
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

export interface PositionAssessment {
  // 对手已形成己方无法全挡的多重胜点（叉），基本已负。
  losing: boolean
  // 己方已形成对手无法招架的多重胜点，稳占上风。
  commanding: boolean
}

export interface AiDecision extends PositionAssessment {
  point: Point | null
  // 局面紧迫度：0 = 唯一手/必应/可直接取胜（宜秒下），1 = 均势宽阔的真岔路口（可长考）。
  criticality: number
}

// threatValue 对 ≥2 个胜点额外加满一个 WIN_SCORE，故 ≥2·WIN_SCORE ⟺ 已成叉（单胜点可挡）。
function assess(threatSelf: number, threatOpp: number) {
  const canWin = threatSelf >= WIN_SCORE
  const mustRespond = threatOpp >= WIN_SCORE
  return {
    canWin,
    mustRespond,
    losing: threatOpp >= 2 * WIN_SCORE && !canWin,
    commanding: threatSelf >= 2 * WIN_SCORE && !mustRespond,
  }
}

// 仅研判胜负态势（一次全盘扫描，不做虚拟对弈）：供只关心和/降决策、无需选点的场景。
export function assessPosition(
  state: GameState,
  seat: Seat,
  difficulty: Difficulty = 'normal',
): PositionAssessment {
  const { candidates } = DIFFICULTY_SETTINGS[difficulty]
  const { threatSelf, threatOpp } = analyzeBoard(state, seat, candidates)
  const { losing, commanding } = assess(threatSelf, threatOpp)
  return { losing, commanding }
}

// 第三层：top-K 收益矩阵 → 虚拟对弈极大极小混合策略 → 采样；也作为无 Worker 时 MCTS 的同步兜底。
// 顺带给出局面研判（紧迫度/胜负态势），供上层拟人调度思考时长与和/降决策。
export function decideAiMove(
  state: GameState,
  seat: Seat,
  difficulty: Difficulty = 'normal',
): AiDecision {
  const { candidates, explore } = DIFFICULTY_SETTINGS[difficulty]
  const { aiMoves, oppMoves, threatSelf, threatOpp } = analyzeBoard(state, seat, candidates)
  const { canWin, mustRespond, losing, commanding } = assess(threatSelf, threatOpp)
  if (aiMoves.length <= 1) {
    return { point: aiMoves[0] ?? null, criticality: 0, losing, commanding }
  }

  const matrix = aiMoves.map((ai) => oppMoves.map((opp) => payoff(state, seat, ai, opp)))
  const equilibrium = solveMaximin(matrix)
  const n = aiMoves.length
  const dist = equilibrium.map((p) => (1 - explore) * p + explore / n)
  const point = aiMoves[sampleIndex(dist)]
  // 均衡越集中在一手 → 最优手越清晰 → 越该快下；防守手选择余地小，也压低紧迫度。
  let criticality = 1 - Math.max(...equilibrium)
  if (mustRespond) criticality *= 0.4
  if (canWin) criticality = 0
  return { point, criticality, losing, commanding }
}

export function chooseAiMove(
  state: GameState,
  seat: Seat,
  difficulty: Difficulty = 'normal',
): Point | null {
  return decideAiMove(state, seat, difficulty).point
}
