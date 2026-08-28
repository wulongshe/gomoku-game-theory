import { BOARD_SIZE, isLegalChoice, type GameState, type Point, type Seat } from './game'

const DIRECTIONS = [
  [1, 0],
  [0, 1],
  [1, 1],
  [1, -1],
] as const

const WIN_SCORE = 1_000_000
const DEFENSE_WEIGHT = 0.9

function lineScore(count: number, openEnds: number): number {
  if (count >= 5) return WIN_SCORE
  if (openEnds === 0) return 0
  if (count === 4) return openEnds === 2 ? 100_000 : 15_000
  if (count === 3) return openEnds === 2 ? 5_000 : 600
  if (count === 2) return openEnds === 2 ? 400 : 60
  return openEnds === 2 ? 40 : 10
}

function placementScore(state: GameState, point: Point, seat: Seat): number {
  let total = 0
  for (const [dx, dy] of DIRECTIONS) {
    let count = 1
    let openEnds = 0
    for (const sign of [1, -1] as const) {
      let x = point.x + dx * sign
      let y = point.y + dy * sign
      while (x >= 0 && x < BOARD_SIZE && y >= 0 && y < BOARD_SIZE) {
        const cell = state.board[y * BOARD_SIZE + x]
        if (cell !== seat && cell !== 'shared') {
          if (cell === 'empty') openEnds++
          break
        }
        count++
        x += dx * sign
        y += dy * sign
      }
    }
    total += lineScore(count, openEnds)
  }
  return total
}

export function chooseAiMove(state: GameState, seat: Seat): Point | null {
  const opponent: Seat = seat === 'black' ? 'white' : 'black'
  let bestScore = -Infinity
  let best: Point[] = []
  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      const point = { x, y }
      if (!isLegalChoice(state, point)) continue
      const score =
        placementScore(state, point, seat) + DEFENSE_WEIGHT * placementScore(state, point, opponent)
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
