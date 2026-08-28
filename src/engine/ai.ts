import {
  BOARD_SIZE,
  cellValue,
  isLegalChoice,
  settleFrame,
  type GameMode,
  type GameState,
  type Point,
  type Seat,
} from './game'

const DIRECTIONS = [
  [1, 0],
  [0, 1],
  [1, 1],
  [1, -1],
] as const

export const WIN_SCORE = 1_000_000
export const TERMINAL = 1_000_000_000

// 同时落子下，抢占对方的强点即是防守：不撞点则该点归己（挡住对方连线），
// 撞点则结果随模式而变。系数衡量「与对方争抢同一点」的收益。
const CONTEST_FACTOR: Record<GameMode, number> = {
  forbidden: 0.9, // 撞点 → 死点，免费封杀
  minus: 0.9, // 撞点 → 负子，封杀且反噬对方连线
  race: 0.45, // 撞点 → 按提交顺序归属，本地是掷硬币，倾向减半
}

export type Difficulty = 'easy' | 'normal' | 'hard'

// candidates：候选宽度 K；explore：在均衡混合策略里混入均匀探索的比例（越高越随机、越弱）；
// budgetMs：第四层 SM-MCTS 后台搜索的时间盒（毫秒），到点即返回当前最优/混合策略。
export const DIFFICULTY_SETTINGS: Record<
  Difficulty,
  { candidates: number; explore: number; budgetMs: number }
> = {
  easy: { candidates: 5, explore: 0.55, budgetMs: 200 },
  normal: { candidates: 6, explore: 0.22, budgetMs: 450 },
  hard: { candidates: 7, explore: 0, budgetMs: 800 },
}

const FICTITIOUS_ITERATIONS = 300

export function other(seat: Seat): Seat {
  return seat === 'black' ? 'white' : 'black'
}

// sum 为连线上的加权和（己子 +1、负子 -1），与引擎判胜一致：
// 满五即 sum ≥ 5，故按「还差多少到五」分级，负子在线内也算数。
function lineScore(sum: number, openEnds: number): number {
  if (sum >= 5) return WIN_SCORE
  if (openEnds === 0) return 0
  const gap = 5 - sum
  if (gap <= 1) return openEnds === 2 ? 100_000 : 15_000
  if (gap <= 2) return openEnds === 2 ? 5_000 : 600
  if (gap <= 3) return openEnds === 2 ? 400 : 60
  return openEnds === 2 ? 40 : 10
}

function placementScore(state: GameState, point: Point, seat: Seat): number {
  let total = 0
  for (const [dx, dy] of DIRECTIONS) {
    let sum = 1
    let openEnds = 0
    for (const sign of [1, -1] as const) {
      let x = point.x + dx * sign
      let y = point.y + dy * sign
      while (x >= 0 && x < BOARD_SIZE && y >= 0 && y < BOARD_SIZE) {
        const cell = state.board[y * BOARD_SIZE + x]
        const value = cellValue(cell, seat)
        if (value === 0) {
          if (cell === 'empty') openEnds++
          break
        }
        sum += value
        x += dx * sign
        y += dy * sign
      }
    }
    total += lineScore(sum, openEnds)
  }
  return total
}

export interface BoardAnalysis {
  aiMoves: Point[]
  oppMoves: Point[]
  threatSelf: number
  threatOpp: number
}

// 单遍扫描全盘：每个合法点只算一次「己方 / 对方」落子威胁，一次性得到双方候选列表与双方威胁强度。
// 候选排序用攻守合一分（自身威胁 + CONTEST×对方威胁，抢占对方强点即防守），
// 威胁强度取最强两手的加权和（撞点规则下单胜点会被撞掉，需双威胁/叉才必胜，故次强也计分）。
// 避免了原先候选生成与局面评估各扫全盘、同一 placementScore 重算三遍。
export function analyzeBoard(state: GameState, seat: Seat, limit: number): BoardAnalysis {
  const opp = other(seat)
  const contest = CONTEST_FACTOR[state.mode]
  const scored: { point: Point; self: number; opp: number }[] = []
  let self1 = 0
  let self2 = 0
  let opp1 = 0
  let opp2 = 0
  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      const point = { x, y }
      if (!isLegalChoice(state, point)) continue
      const self = placementScore(state, point, seat)
      const oppScore = placementScore(state, point, opp)
      scored.push({ point, self, opp: oppScore })
      if (self > self1) {
        self2 = self1
        self1 = self
      } else if (self > self2) {
        self2 = self
      }
      if (oppScore > opp1) {
        opp2 = opp1
        opp1 = oppScore
      } else if (oppScore > opp2) {
        opp2 = oppScore
      }
    }
  }
  const aiMoves = scored
    .slice()
    .sort((a, b) => b.self + contest * b.opp - (a.self + contest * a.opp))
    .slice(0, limit)
    .map((s) => s.point)
  const oppMoves = scored
    .slice()
    .sort((a, b) => b.opp + contest * b.self - (a.opp + contest * a.self))
    .slice(0, limit)
    .map((s) => s.point)
  return { aiMoves, oppMoves, threatSelf: self1 + 0.25 * self2, threatOpp: opp1 + 0.25 * opp2 }
}

// 全盘威胁强度：取最强两手的加权和。撞点规则下单个胜点会被对方撞掉，
// 需两个胜点（双威胁/叉）才必胜，故让次强手也计分，比单一强点更值钱。
function threatScore(state: GameState, seat: Seat): number {
  let best = 0
  let second = 0
  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      const point = { x, y }
      if (!isLegalChoice(state, point)) continue
      const score = placementScore(state, point, seat)
      if (score > best) {
        second = best
        best = score
      } else if (score > second) {
        second = score
      }
    }
  }
  return best + 0.25 * second
}

// 从 seat 视角评估结算后的局面：终局用 ±TERMINAL，进行中用双方威胁强度之差。
export function evaluateState(state: GameState, seat: Seat): number {
  if (state.phase !== 'playing') {
    if (state.phase === 'draw') return 0
    const won = state.phase === (seat === 'black' ? 'black_won' : 'white_won')
    return won ? TERMINAL : -TERMINAL
  }
  return threatScore(state, seat) - threatScore(state, other(seat))
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

export function sampleIndex(dist: number[]): number {
  const r = Math.random()
  let acc = 0
  for (let i = 0; i < dist.length; i++) {
    acc += dist[i]
    if (r <= acc) return i
  }
  return dist.length - 1
}

export function chooseAiMove(
  state: GameState,
  seat: Seat,
  difficulty: Difficulty = 'normal',
): Point | null {
  const { candidates, explore } = DIFFICULTY_SETTINGS[difficulty]
  const { aiMoves, oppMoves } = analyzeBoard(state, seat, candidates)
  if (aiMoves.length <= 1) return aiMoves[0] ?? null

  const matrix = aiMoves.map((ai) => oppMoves.map((opp) => payoff(state, seat, ai, opp)))

  // 必胜手：某行对手所有回应都稳赢，直接落子，不做随机化。
  let forced = 0
  let forcedSecurity = -Infinity
  for (let i = 0; i < aiMoves.length; i++) {
    let security = Infinity
    for (let j = 0; j < oppMoves.length; j++) security = Math.min(security, matrix[i][j])
    if (security > forcedSecurity) {
      forcedSecurity = security
      forced = i
    }
  }
  if (forcedSecurity >= TERMINAL / 2) return aiMoves[forced]

  const equilibrium = solveMaximin(matrix)
  const n = aiMoves.length
  const dist = equilibrium.map((p) => (1 - explore) * p + explore / n)
  return aiMoves[sampleIndex(dist)]
}
