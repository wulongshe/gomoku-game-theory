import { settleFrame, type GameState, type Point, type Seat } from './game'
import { analyzeBoard, evaluateState, other, sampleIndex, WIN_SCORE } from './eval'

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

// 对手模型：观察人类每帧实际落子，估计其「理性程度」r ∈ [0,1]（1 = 完全理性、必然封堵成五点）。
// 每帧给一个二元信号（本帧应对是否理性），r 向信号指数滑动。
const OPPONENT_LEARN_RATE = 0.25
const OPPONENT_CANDIDATES = 7

function isSamePoint(a: Point, b: Point): boolean {
  return a.x === b.x && a.y === b.y
}

// 本帧人类落子是否「理性」：先看赢棋/封堵 AI 成五，再看是否下得像样（落在自己 top-K 候选）。
function opponentSignal(before: GameState, humanSeat: Seat, humanMove: Point, settled: GameState): number {
  const won = settled.phase === (humanSeat === 'black' ? 'black_won' : 'white_won')
  if (won) return 1 // 能赢并赢了，最理性
  const aiAnalysis = analyzeBoard(before, other(humanSeat), OPPONENT_CANDIDATES)
  if (aiAnalysis.threatSelf >= WIN_SCORE) {
    // AI 有立即成五点：封堵（抢点）即理性，放任即非理性
    return aiAnalysis.aiMoves.some((p) => isSamePoint(p, humanMove)) ? 1 : 0
  }
  const humanAnalysis = analyzeBoard(before, humanSeat, OPPONENT_CANDIDATES)
  if (humanAnalysis.threatSelf >= WIN_SCORE) return 0 // 自己有成五点却不下
  return humanAnalysis.aiMoves.some((p) => isSamePoint(p, humanMove)) ? 1 : 0
}

export function updateOpponentRationality(
  before: GameState,
  humanSeat: Seat,
  humanMove: Point | null,
  settled: GameState,
  r: number,
): number {
  if (!humanMove) return r // 超时弃着，无信息
  return r + OPPONENT_LEARN_RATE * (opponentSignal(before, humanSeat, humanMove, settled) - r)
}

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
// 虚拟对弈求解零和博弈；opponentRandomness ∈ [0,1] 时对手以该概率随机应对而非最优回应，
// 列经验分布收敛于「理性×最优 + 非理性×随机」的混合，AI 均衡随之更激进。
function solveMaximin(matrix: number[][], opponentRandomness: number): number[] {
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
    if (opponentRandomness > 0 && Math.random() < opponentRandomness) {
      bestCol = Math.floor(Math.random() * cols)
    }
    colCount[bestCol]++
  }
  return rowCount.map((c) => c / FICTITIOUS_ITERATIONS)
}

// 第三层：top-K 收益矩阵 → 虚拟对弈极大极小混合策略 → 采样；也作为无 Worker 时 MCTS 的同步兜底。
// opponentRationality ∈ [0,1] 为观察到的对手理性程度（1 = 完全理性，默认保持原行为）。
export function chooseAiMove(
  state: GameState,
  seat: Seat,
  difficulty: Difficulty = 'normal',
  opponentRationality = 1,
): Point | null {
  const { candidates, explore } = DIFFICULTY_SETTINGS[difficulty]
  const { aiMoves, oppMoves } = analyzeBoard(state, seat, candidates)
  if (aiMoves.length <= 1) return aiMoves[0] ?? null

  const matrix = aiMoves.map((ai) => oppMoves.map((opp) => payoff(state, seat, ai, opp)))
  const equilibrium = solveMaximin(matrix, 1 - opponentRationality)
  const n = aiMoves.length
  const dist = equilibrium.map((p) => (1 - explore) * p + explore / n)
  return aiMoves[sampleIndex(dist)]
}
