export const BOARD_SIZE = 15
export const FRAME_SECONDS = 30

export type Seat = 'black' | 'white'
export type CellState = 'empty' | 'black' | 'white' | 'forbidden'
export type Phase = 'playing' | 'black_won' | 'white_won' | 'draw'

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
  cleared: ClearedGroup[]
  lastMoves: Point[]
  winningLines: Point[][]
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
    cleared: [],
    lastMoves: [],
    winningLines: [],
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

// 经过 point、沿 (dx,dy) 方向连续同为 cell 的格子下标，按方向顺序排列。
function runThrough<C extends string>(
  board: readonly C[],
  size: number,
  point: Point,
  cell: C,
  dx: number,
  dy: number,
): number[] {
  const line = [point.y * size + point.x]
  for (const sign of [1, -1] as const) {
    let x = point.x + dx * sign
    let y = point.y + dy * sign
    while (x >= 0 && x < size && y >= 0 && y < size && board[y * size + x] === cell) {
      if (sign === 1) line.push(y * size + x)
      else line.unshift(y * size + x)
      x += dx * sign
      y += dy * sign
    }
  }
  return line
}

// 经过 point 的所有 ≥5 连线（每个方向至多一条），棋盘边长由 size 指定。
export function winningLines<C extends string>(
  board: readonly C[],
  cell: C,
  point: Point,
  size = BOARD_SIZE,
): number[][] {
  if (board[point.y * size + point.x] !== cell) return []
  const lines: number[][] = []
  for (const [dx, dy] of DIRECTIONS) {
    const line = runThrough(board, size, point, cell, dx, dy)
    if (line.length >= WIN_SCORE) lines.push(line)
  }
  return lines
}

// 该方还有没有可能凑出五连：把所有空点都让给它（禁点即落在空点上），逐个空点当「最后一手」查连线。
// 判否即这一方永远赢不了。
export function fivePossible<C extends string>(
  board: readonly C[],
  cell: C,
  empty: C,
  size = BOARD_SIZE,
): boolean {
  const hypo = board.map((c) => (c === empty ? cell : c))
  for (let i = 0; i < board.length; i++) {
    if (board[i] !== empty) continue
    if (winningLines(hypo, cell, { x: i % size, y: Math.floor(i / size) }, size).length) return true
  }
  return false
}

// 死局判和：黑、白与禁点三方都不可能再成五即终局。禁点成五必须算「还有变化」——
// 禁点五连会清空复位、翻出新空点，不能提前判和。
function isDeadDraw(board: CellState[]): boolean {
  return (
    !fivePossible(board, 'black', 'empty') &&
    !fivePossible(board, 'white', 'empty') &&
    !fivePossible(board, 'forbidden', 'empty')
  )
}

export function settleFrame(state: GameState, choices: FrameChoices): GameState {
  if (state.phase !== 'playing') throw new Error('game is over')
  for (const seat of ['black', 'white'] as const) {
    const point = choices[seat]
    if (point && !isLegalChoice(state, point)) throw new Error(`illegal choice for ${seat}`)
  }

  const board = [...state.board]
  const { black, white } = choices
  const collision = black && white && black.x === white.x && black.y === white.y ? black : null

  if (collision) {
    board[collision.y * BOARD_SIZE + collision.x] = 'forbidden'
  } else {
    if (black) board[black.y * BOARD_SIZE + black.x] = 'black'
    if (white) board[white.y * BOARD_SIZE + white.x] = 'white'
  }

  const blackLines = black ? winningLines(board, 'black', black) : []
  const whiteLines = white ? winningLines(board, 'white', white) : []
  const blackRun = [...new Set(blackLines.flat())]
  const whiteRun = [...new Set(whiteLines.flat())]

  const toCell = (i: number): ClearedCell => ({
    x: i % BOARD_SIZE,
    y: Math.floor(i / BOARD_SIZE),
    cell: board[i],
  })
  const toPoint = (i: number): Point => ({ x: i % BOARD_SIZE, y: Math.floor(i / BOARD_SIZE) })

  const cleared: ClearedGroup[] = []
  let phase: Phase = 'playing'
  let winning: number[][] = []
  if (blackRun.length && whiteRun.length) {
    cleared.push({ origin: black!, cells: blackRun.map(toCell) })
    cleared.push({ origin: white!, cells: whiteRun.map(toCell) })
    for (const i of [...blackRun, ...whiteRun]) board[i] = 'empty'
  } else if (blackRun.length) {
    phase = 'black_won'
    winning = blackLines
  } else if (whiteRun.length) {
    phase = 'white_won'
    winning = whiteLines
  }

  if (phase === 'playing') {
    // 禁点只由本帧撞子产生、满五当帧即清，故任何禁点五连都经过本帧的撞点。
    const runs = collision ? winningLines(board, 'forbidden', collision) : []
    for (const run of runs) cleared.push({ origin: collision!, cells: run.map(toCell) })
    for (const i of runs.flat()) board[i] = 'empty'
    if (isDeadDraw(board)) phase = 'draw'
  }

  const lastMoves = (collision ? [collision] : [black, white]).filter(
    (p): p is Point => p !== null && board[p.y * BOARD_SIZE + p.x] !== 'empty',
  )

  return {
    board,
    phase,
    frame: state.frame + 1,
    cleared,
    lastMoves,
    winningLines: winning.map((line) => line.map(toPoint)),
  }
}
