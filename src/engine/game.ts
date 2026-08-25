export const BOARD_SIZE = 15
export const FRAME_SECONDS = 30

export type Seat = 'black' | 'white'
export type CellState = 'empty' | 'black' | 'white' | 'forbidden' | 'half'
export type Phase = 'playing' | 'black_won' | 'white_won' | 'draw'
export type GameMode = 'forbidden' | 'half'

export interface Point {
  x: number
  y: number
}

export interface ClearedCell extends Point {
  cell: CellState
}

export interface ClearedGroup {
  origin: Point
  cells: ClearedCell[]
}

export interface GameState {
  board: CellState[]
  phase: Phase
  frame: number
  mode: GameMode
  cleared: ClearedGroup[]
  lastMoves: Point[]
}

export interface FrameChoices {
  black: Point | null
  white: Point | null
}

export function createGame(mode: GameMode = 'forbidden'): GameState {
  return {
    board: Array(BOARD_SIZE * BOARD_SIZE).fill('empty'),
    phase: 'playing',
    frame: 1,
    mode,
    cleared: [],
    lastMoves: [],
  }
}

export function cellAt(state: GameState, point: Point): CellState {
  return state.board[point.y * BOARD_SIZE + point.x]
}

const CENTER = (BOARD_SIZE - 1) / 2

export function inOpeningArea(point: Point): boolean {
  const dx = Math.abs(point.x - CENTER)
  const dy = Math.abs(point.y - CENTER)
  return dx <= 1 && dy <= 1 && dx + dy !== 0
}

export function isLegalChoice(state: GameState, point: Point): boolean {
  return (
    state.phase === 'playing' &&
    point.x >= 0 &&
    point.x < BOARD_SIZE &&
    point.y >= 0 &&
    point.y < BOARD_SIZE &&
    cellAt(state, point) === 'empty' &&
    (state.frame > 1 || inOpeningArea(point))
  )
}

const DIRECTIONS = [
  [1, 0],
  [0, 1],
  [1, 1],
  [1, -1],
] as const

const WIN_SCORE = 5

function cellValue(cell: CellState, seat: Seat): number {
  if (cell === seat) return 1
  if (cell === 'half') return 0.5
  return 0
}

function winningRun(board: CellState[], seat: Seat, point: Point): number[] {
  const start = point.y * BOARD_SIZE + point.x
  if (cellValue(board[start], seat) === 0) return []
  const cells = new Set<number>()
  for (const [dx, dy] of DIRECTIONS) {
    const line = [start]
    let score = cellValue(board[start], seat)
    for (const sign of [1, -1] as const) {
      let x = point.x + dx * sign
      let y = point.y + dy * sign
      while (x >= 0 && x < BOARD_SIZE && y >= 0 && y < BOARD_SIZE) {
        const value = cellValue(board[y * BOARD_SIZE + x], seat)
        if (value === 0) break
        score += value
        line.push(y * BOARD_SIZE + x)
        x += dx * sign
        y += dy * sign
      }
    }
    if (score >= WIN_SCORE) for (const i of line) cells.add(i)
  }
  return [...cells]
}

function forbiddenRuns(board: CellState[]): number[][] {
  const runs: number[][] = []
  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      if (board[y * BOARD_SIZE + x] !== 'forbidden') continue
      for (const [dx, dy] of DIRECTIONS) {
        const px = x - dx
        const py = y - dy
        const startsHere =
          px < 0 ||
          px >= BOARD_SIZE ||
          py < 0 ||
          py >= BOARD_SIZE ||
          board[py * BOARD_SIZE + px] !== 'forbidden'
        if (!startsHere) continue
        const line: number[] = []
        let cx = x
        let cy = y
        while (cx >= 0 && cx < BOARD_SIZE && cy >= 0 && cy < BOARD_SIZE && board[cy * BOARD_SIZE + cx] === 'forbidden') {
          line.push(cy * BOARD_SIZE + cx)
          cx += dx
          cy += dy
        }
        if (line.length >= WIN_SCORE) runs.push(line)
      }
    }
  }
  return runs
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
    board[black.y * BOARD_SIZE + black.x] = state.mode === 'half' ? 'half' : 'forbidden'
  } else {
    if (black) board[black.y * BOARD_SIZE + black.x] = 'black'
    if (white) board[white.y * BOARD_SIZE + white.x] = 'white'
  }

  const blackRun = black ? winningRun(board, 'black', black) : []
  const whiteRun = white ? winningRun(board, 'white', white) : []

  const toCell = (i: number): ClearedCell => ({
    x: i % BOARD_SIZE,
    y: Math.floor(i / BOARD_SIZE),
    cell: board[i],
  })

  const cleared: ClearedGroup[] = []
  let phase: Phase = 'playing'
  if (blackRun.length && whiteRun.length) {
    cleared.push({ origin: black!, cells: blackRun.map(toCell) })
    cleared.push({ origin: white!, cells: whiteRun.map(toCell) })
    for (const i of [...blackRun, ...whiteRun]) board[i] = 'empty'
  } else if (blackRun.length) phase = 'black_won'
  else if (whiteRun.length) phase = 'white_won'

  if (phase === 'playing') {
    const runs = forbiddenRuns(board)
    const collision =
      black && white && black.x === white.x && black.y === white.y
        ? black.y * BOARD_SIZE + black.x
        : null
    for (const run of runs) {
      const origin = collision !== null && run.includes(collision) ? collision : run[0]
      cleared.push({ origin: toCell(origin), cells: run.map(toCell) })
    }
    for (const i of runs.flat()) board[i] = 'empty'
    if (!board.includes('empty')) phase = 'draw'
  }

  const collided = black && white && black.x === white.x && black.y === white.y
  const lastMoves = (collided ? [black] : [black, white]).filter(
    (p): p is Point =>
      p !== null && ['black', 'white', 'half'].includes(board[p.y * BOARD_SIZE + p.x]),
  )

  return { board, phase, frame: state.frame + 1, mode: state.mode, cleared, lastMoves }
}
