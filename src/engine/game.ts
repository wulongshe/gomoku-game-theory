export const BOARD_SIZE = 15
export const FRAME_SECONDS = 30

export type Seat = 'p1' | 'p2'
export type CellState = 'empty' | 'p1' | 'p2' | 'forbidden'
export type Phase = 'playing' | 'p1_won' | 'p2_won' | 'draw'

export interface Point {
  x: number
  y: number
}

export interface GameState {
  board: CellState[]
  phase: Phase
  frame: number
}

export interface FrameChoices {
  p1: Point | null
  p2: Point | null
}

export function createGame(): GameState {
  return {
    board: Array(BOARD_SIZE * BOARD_SIZE).fill('empty'),
    phase: 'playing',
    frame: 1,
  }
}

export function cellAt(state: GameState, point: Point): CellState {
  return state.board[point.y * BOARD_SIZE + point.x]
}

export function isLegalChoice(state: GameState, point: Point): boolean {
  return (
    state.phase === 'playing' &&
    point.x >= 0 &&
    point.x < BOARD_SIZE &&
    point.y >= 0 &&
    point.y < BOARD_SIZE &&
    cellAt(state, point) === 'empty'
  )
}

const DIRECTIONS = [
  [1, 0],
  [0, 1],
  [1, 1],
  [1, -1],
] as const

function hasFiveThrough(board: CellState[], seat: Seat, point: Point): boolean {
  for (const [dx, dy] of DIRECTIONS) {
    let count = 1
    for (const sign of [1, -1] as const) {
      let x = point.x + dx * sign
      let y = point.y + dy * sign
      while (
        x >= 0 &&
        x < BOARD_SIZE &&
        y >= 0 &&
        y < BOARD_SIZE &&
        board[y * BOARD_SIZE + x] === seat
      ) {
        count++
        x += dx * sign
        y += dy * sign
      }
    }
    if (count >= 5) return true
  }
  return false
}

export function settleFrame(state: GameState, choices: FrameChoices): GameState {
  if (state.phase !== 'playing') throw new Error('game is over')
  for (const seat of ['p1', 'p2'] as const) {
    const point = choices[seat]
    if (point && !isLegalChoice(state, point)) throw new Error(`illegal choice for ${seat}`)
  }

  const board = [...state.board]
  const { p1, p2 } = choices

  if (p1 && p2 && p1.x === p2.x && p1.y === p2.y) {
    board[p1.y * BOARD_SIZE + p1.x] = 'forbidden'
  } else {
    if (p1) board[p1.y * BOARD_SIZE + p1.x] = 'p1'
    if (p2) board[p2.y * BOARD_SIZE + p2.x] = 'p2'
  }

  const p1Won = p1 !== null && board[p1.y * BOARD_SIZE + p1.x] === 'p1' && hasFiveThrough(board, 'p1', p1)
  const p2Won = p2 !== null && board[p2.y * BOARD_SIZE + p2.x] === 'p2' && hasFiveThrough(board, 'p2', p2)

  let phase: Phase = 'playing'
  if (p1Won && p2Won) phase = 'draw'
  else if (p1Won) phase = 'p1_won'
  else if (p2Won) phase = 'p2_won'
  else if (!board.includes('empty')) phase = 'draw'

  return { board, phase, frame: state.frame + 1 }
}
