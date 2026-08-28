import {
  BOARD_SIZE,
  cellValue,
  isLegalChoice,
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

const WIN_SCORE = 1_000_000

// 同时落子下，抢占对方的强点即是防守：不撞点则该点归己（挡住对方连线），
// 撞点则结果随模式而变。系数衡量「与对方争抢同一点」的收益，恒 < 1，
// 保证自己能成五（攻分 = WIN_SCORE）时永远优先自己赢，而非只做防守。
const CONTEST_FACTOR: Record<GameMode, number> = {
  forbidden: 0.9, // 撞点 → 死点，免费封杀
  minus: 0.9, // 撞点 → 负子，封杀且反噬对方连线
  race: 0.45, // 撞点 → 按提交顺序归属，本地是掷硬币，倾向减半
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

export function chooseAiMove(state: GameState, seat: Seat): Point | null {
  const opponent: Seat = seat === 'black' ? 'white' : 'black'
  const contest = CONTEST_FACTOR[state.mode]
  let bestScore = -Infinity
  let best: Point[] = []
  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      const point = { x, y }
      if (!isLegalChoice(state, point)) continue
      const score =
        placementScore(state, point, seat) + contest * placementScore(state, point, opponent)
      if (score > bestScore) {
        bestScore = score
        best = [point]
      } else if (score === bestScore) {
        best.push(point)
      }
    }
  }
  if (best.length === 0) return null
  return best[Math.floor(Math.random() * best.length)]
}
