import { BOARD_SIZE, isLegalChoice, type GameState, type Point, type Seat } from './game'

const DIRECTIONS = [
  [1, 0],
  [0, 1],
  [1, 1],
  [1, -1],
] as const

export const WIN_SCORE = 1_000_000
export const TERMINAL = 1_000_000_000

// 同时落子下抢占对方强点即防守；系数衡量「与对方争抢同一点」的净收益（恒 < 1，能赢时优先自己赢）。
const CONTEST_FACTOR = 0.9

export function other(seat: Seat): Seat {
  return seat === 'black' ? 'white' : 'black'
}

// sum 为连线己子数（≥5 即五连）；按「还差几子到五」分级。
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
        if (cell !== seat) {
          if (cell === 'empty') openEnds++
          break
        }
        sum++
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

// 威胁强度：最强两手加权和 + 多出胜点重奖。撞子下单胜点必被撞掉，两个及以上才成「对手撞不全」的猜点局面，
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

// 把 point 按 key 降序插入定长（≤limit）榜单；等值键随机插入、随机挤出，并列点机会均等
// （固定顺序会让开局八点全等值时永远先下 (6,6)）。
function insertTop(top: { point: Point; key: number }[], point: Point, key: number, limit: number): void {
  if (top.length >= limit && key < top[top.length - 1].key) return
  let lo = 0
  let hi = top.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (top[mid].key < key) hi = mid
    else lo = mid + 1
  }
  let runStart = lo
  while (runStart > 0 && top[runStart - 1].key === key) runStart--
  top.splice(runStart + Math.floor(Math.random() * (lo - runStart + 1)), 0, { point, key })
  if (top.length > limit) top.pop()
}

// 单遍扫全盘：每个合法点只算一次双方 placementScore，直接维护两份定长榜单选出候选（攻守合一分），
// 同时累计双方威胁强度；免去候选、评估各扫一遍、同一分重算三遍，也省掉整盘 scored 数组与两次排序。
export function analyzeBoard(state: GameState, seat: Seat, limit: number): BoardAnalysis {
  const opp = other(seat)
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
      insertTop(aiTop, point, self + CONTEST_FACTOR * oppScore, limit)
      insertTop(oppTop, point, oppScore + CONTEST_FACTOR * self, limit)
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

// 按概率分布 dist 采样一个下标（dist 和为 1）。
export function sampleIndex(dist: number[]): number {
  const r = Math.random()
  let acc = 0
  for (let i = 0; i < dist.length; i++) {
    acc += dist[i]
    if (r <= acc) return i
  }
  return dist.length - 1
}
