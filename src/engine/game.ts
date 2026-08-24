export const BOARD_SIZE = 15
export const FRAME_SECONDS = 30

export type Seat = 'black' | 'white'
export type CellState = 'empty' | 'black' | 'white' | 'forbidden'
export type Phase = 'playing' | 'black_won' | 'white_won' | 'draw'

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
  black: Point | null
  white: Point | null
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
  for (const seat of ['black', 'white'] as const) {
    const point = choices[seat]
    if (point && !isLegalChoice(state, point)) throw new Error(`illegal choice for ${seat}`)
  }

  const board = [...state.board]
  const { black, white } = choices

  if (black && white && black.x === white.x && black.y === white.y) {
    board[black.y * BOARD_SIZE + black.x] = 'forbidden'
  } else {
    if (black) board[black.y * BOARD_SIZE + black.x] = 'black'
    if (white) board[white.y * BOARD_SIZE + white.x] = 'white'
  }

  const blackWon = black !== null && board[black.y * BOARD_SIZE + black.x] === 'black' && hasFiveThrough(board, 'black', black)
  const whiteWon = white !== null && board[white.y * BOARD_SIZE + white.x] === 'white' && hasFiveThrough(board, 'white', white)

  let phase: Phase = 'playing'
  if (blackWon && whiteWon) phase = 'draw'
  else if (blackWon) phase = 'black_won'
  else if (whiteWon) phase = 'white_won'
  else if (!board.includes('empty')) phase = 'draw'

  return { board, phase, frame: state.frame + 1 }
}
