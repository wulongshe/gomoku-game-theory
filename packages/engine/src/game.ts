export const BOARD_SIZE = 15
export const FRAME_SECONDS = 30

export type Seat = 'black' | 'white'
export type CellState = 'empty' | 'black' | 'white' | 'forbidden' | 'minus'
export type Phase = 'playing' | 'black_won' | 'white_won' | 'draw'
export type GameMode = 'forbidden' | 'minus'

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
  winningLines: Point[][]
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

export function cellValue(cell: CellState, seat: Seat): number {
  if (cell === seat) return 1
  if (cell === 'minus') return -1
  return 0
}

function winningLines(board: CellState[], seat: Seat, point: Point): number[][] {
  const start = point.y * BOARD_SIZE + point.x
  if (cellValue(board[start], seat) === 0) return []
  const lines: number[][] = []
  for (const [dx, dy] of DIRECTIONS) {
    const halves: Record<1 | -1, number[]> = { 1: [], [-1]: [] }
    let score = cellValue(board[start], seat)
    for (const sign of [1, -1] as const) {
      let x = point.x + dx * sign
      let y = point.y + dy * sign
      // 连线可在负子前截断：每侧取加权和最大的前缀，段尾的负子不计入（如 负1111_ 补空成五连即胜）。
      const walk: number[] = []
      let sum = 0
      let best = 0
      let bestLen = 0
      while (x >= 0 && x < BOARD_SIZE && y >= 0 && y < BOARD_SIZE) {
        const value = cellValue(board[y * BOARD_SIZE + x], seat)
        if (value === 0) break
        sum += value
        walk.push(y * BOARD_SIZE + x)
        if (sum > best) {
          best = sum
          bestLen = walk.length
        }
        x += dx * sign
        y += dy * sign
      }
      halves[sign] = walk.slice(0, bestLen)
      score += best
    }
    if (score >= WIN_SCORE) lines.push([...halves[-1].reverse(), start, ...halves[1]])
  }
  return lines
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

// 该方还有没有可能凑出五连：把所有空点都让给它（对碰撞出的第三方棋子即落在空点上），
// 逐个空点当「最后一手」跑胜线判定。判否即这一方永远赢不了。
function fivePossible(board: CellState[], seat: Seat | 'forbidden' | 'minus'): boolean {
  const hypo = board.map((cell) => (cell === 'empty' ? seat : cell))
  for (let i = 0; i < board.length; i++) {
    if (board[i] !== 'empty') continue
    const point = { x: i % BOARD_SIZE, y: Math.floor(i / BOARD_SIZE) }
    if (seat === 'forbidden' || seat === 'minus') {
      for (const [dx, dy] of DIRECTIONS) {
        let run = 1
        for (const sign of [1, -1] as const) {
          let x = point.x + dx * sign
          let y = point.y + dy * sign
          while (x >= 0 && x < BOARD_SIZE && y >= 0 && y < BOARD_SIZE && hypo[y * BOARD_SIZE + x] === seat) {
            run++
            x += dx * sign
            y += dy * sign
          }
        }
        if (run >= WIN_SCORE) return true
      }
    } else if (winningLines(hypo, seat, point).length) {
      return true
    }
  }
  return false
}

// 死局判和：黑、白与碰撞子三方都不可能再成五即终局。碰撞子成五必须算「还有变化」——
// 禁子五连会清空复位、翻出新空点，不能提前判和。
function isDeadDraw(board: CellState[], mode: GameMode): boolean {
  return (
    !fivePossible(board, 'black') &&
    !fivePossible(board, 'white') &&
    !fivePossible(board, mode === 'minus' ? 'minus' : 'forbidden')
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

  if (black && white && black.x === white.x && black.y === white.y) {
    board[black.y * BOARD_SIZE + black.x] = state.mode === 'minus' ? 'minus' : 'forbidden'
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
    if (isDeadDraw(board, state.mode)) phase = 'draw'
  }

  const collided = black && white && black.x === white.x && black.y === white.y
  const lastMoves = (collided ? [black] : [black, white]).filter(
    (p): p is Point =>
      p !== null &&
      ['black', 'white', 'minus', 'forbidden'].includes(board[p.y * BOARD_SIZE + p.x]),
  )

  return {
    board,
    phase,
    frame: state.frame + 1,
    mode: state.mode,
    cleared,
    lastMoves,
    winningLines: winning.map((line) => line.map(toPoint)),
  }
}
