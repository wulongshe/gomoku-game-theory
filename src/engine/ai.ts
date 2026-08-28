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

// 同时落子下抢占对方强点即防守；系数衡量「与对方争抢同一点」的净收益（恒 < 1，能赢时优先自己赢）。
const CONTEST_FACTOR: Record<GameMode, number> = {
  forbidden: 0.9, // 撞点 → 死点，免费封杀
  minus: 0.9, // 撞点 → 负子，封杀且反噬对方连线
  race: 0.45, // 撞点 → 按提交顺序归属，本地是掷硬币，倾向减半
}

export type Difficulty = 'easy' | 'normal' | 'hard'

// explore：均衡分布里混入均匀探索的比例（越高越随机越弱）；budgetMs：SM-MCTS 时间盒（毫秒）。
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

// sum 为连线加权和（己子 +1、负子 -1），与判胜一致（≥5 即五连）；按「还差几子到五」分级。
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

const EXTRA_WIN_CAP = 4
// 非终局威胁强度上限（best + 0.25 次强 + 至多 EXTRA_WIN_CAP 个多余胜点），供叶子归一化定标。
export const MAX_THREAT_VALUE = WIN_SCORE * (1.25 + EXTRA_WIN_CAP)

// 威胁强度：最强两手加权和 + 多出胜点重奖。撞点下单胜点必被撞掉，两个及以上才成「对手撞不全」的猜点局面，
// 故 wins-1 显式加分，让双威胁/叉远高于单威胁 —— 本变体分胜负的核心。
function threatValue(best: number, second: number, wins: number): number {
  return best + 0.25 * second + WIN_SCORE * Math.min(EXTRA_WIN_CAP, Math.max(0, wins - 1))
}

export interface BoardAnalysis {
  aiMoves: Point[]
  oppMoves: Point[]
  threatSelf: number
  threatOpp: number
}

// 把 point 按 key 降序插入定长（≤limit）榜单，等值时先到者在前（与稳定排序取 topK 等价）。
function insertTop(top: { point: Point; key: number }[], point: Point, key: number, limit: number): void {
  if (top.length >= limit && key <= top[top.length - 1].key) return
  let lo = 0
  let hi = top.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (top[mid].key < key) hi = mid
    else lo = mid + 1
  }
  top.splice(lo, 0, { point, key })
  if (top.length > limit) top.pop()
}

// 单遍扫全盘：每个合法点只算一次双方 placementScore，直接维护两份定长榜单选出候选（攻守合一分），
// 同时累计双方威胁强度；免去候选、评估各扫一遍、同一分重算三遍，也省掉整盘 scored 数组与两次排序。
export function analyzeBoard(state: GameState, seat: Seat, limit: number): BoardAnalysis {
  const opp = other(seat)
  const contest = CONTEST_FACTOR[state.mode]
  const aiTop: { point: Point; key: number }[] = []
  const oppTop: { point: Point; key: number }[] = []
  let self1 = 0
  let self2 = 0
  let opp1 = 0
  let opp2 = 0
  let selfWins = 0
  let oppWins = 0
  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      const point = { x, y }
      if (!isLegalChoice(state, point)) continue
      const self = placementScore(state, point, seat)
      const oppScore = placementScore(state, point, opp)
      if (self >= WIN_SCORE) selfWins++
      if (oppScore >= WIN_SCORE) oppWins++
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
      insertTop(aiTop, point, self + contest * oppScore, limit)
      insertTop(oppTop, point, oppScore + contest * self, limit)
    }
  }
  return {
    aiMoves: aiTop.map((t) => t.point),
    oppMoves: oppTop.map((t) => t.point),
    threatSelf: threatValue(self1, self2, selfWins),
    threatOpp: threatValue(opp1, opp2, oppWins),
  }
}

// 结算后某方威胁强度（threatValue 的全盘扫描版）。
function threatScore(state: GameState, seat: Seat): number {
  let best = 0
  let second = 0
  let wins = 0
  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      const point = { x, y }
      if (!isLegalChoice(state, point)) continue
      const score = placementScore(state, point, seat)
      if (score >= WIN_SCORE) wins++
      if (score > best) {
        second = best
        best = score
      } else if (score > second) {
        second = score
      }
    }
  }
  return threatValue(best, second, wins)
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
  const equilibrium = solveMaximin(matrix)
  const n = aiMoves.length
  const dist = equilibrium.map((p) => (1 - explore) * p + explore / n)
  return aiMoves[sampleIndex(dist)]
}
