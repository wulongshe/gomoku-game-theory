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

export function settleFrame(_state: GameState, _choices: FrameChoices): GameState {
  throw new Error('not implemented')
}
