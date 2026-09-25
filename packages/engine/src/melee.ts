import { fivePossible, winningLines, type Point } from './game'

// 大乱斗：3~5 人同时落子，连成五即「完赛」并按先后排名，其余人继续，直到只剩一人或死局。
export const MELEE_BOARD_SIZE = 19
export const MELEE_COLORS = ['black', 'white', 'purple', 'yellow', 'blue'] as const
export const MELEE_PLAYER_OPTIONS = [3, 4, 5]
export const MELEE_FRAME_SECONDS = 60

export type Color = (typeof MELEE_COLORS)[number]
export type MeleeCell = 'empty' | Color | 'forbidden'

export interface MeleeClearedCell extends Point {
  cell: MeleeCell
}

export interface MeleeClearedGroup {
  origin: Point
  cells: MeleeClearedCell[]
}

export interface MeleeState {
  board: MeleeCell[]
  phase: 'playing' | 'over'
  frame: number
  players: Color[]
  // 仍在下的人；完赛（连五）或退出即移出。
  active: Color[]
  // 完赛名次：连五者按先后入榜，终局时剩下的人垫底并列。
  ranking: Color[]
  // 中途退出者，不入榜。
  out: Color[]
  cleared: MeleeClearedGroup[]
  lastMoves: Point[]
  winningLines: Point[][]
}

export type MeleeChoices = Partial<Record<Color, Point | null>>

const SIZE = MELEE_BOARD_SIZE
const CENTER = (SIZE - 1) / 2

export function createMelee(players: Color[]): MeleeState {
  return {
    board: Array(SIZE * SIZE).fill('empty'),
    phase: 'playing',
    frame: 1,
    players,
    active: [...players],
    ranking: [],
    out: [],
    cleared: [],
    lastMoves: [],
    winningLines: [],
  }
}

export function meleeCellAt(state: MeleeState, point: Point): MeleeCell {
  return state.board[point.y * SIZE + point.x]
}

export function inMeleeOpeningArea(point: Point): boolean {
  const dx = Math.abs(point.x - CENTER)
  const dy = Math.abs(point.y - CENTER)
  return dx <= 1 && dy <= 1 && dx + dy !== 0
}

export function isLegalMeleeChoice(state: MeleeState, color: Color, point: Point): boolean {
  return (
    state.phase === 'playing' &&
    state.active.includes(color) &&
    point.x >= 0 &&
    point.x < SIZE &&
    point.y >= 0 &&
    point.y < SIZE &&
    meleeCellAt(state, point) === 'empty' &&
    (state.frame > 1 || inMeleeOpeningArea(point))
  )
}

function toPoint(i: number): Point {
  return { x: i % SIZE, y: Math.floor(i / SIZE) }
}

// 只剩一人或谁都连不成五即终局，仍在场的人并列垫底入榜。
function finish(state: MeleeState): MeleeState {
  const deadDraw =
    !fivePossible(state.board, 'forbidden', 'empty', SIZE) &&
    state.active.every((color) => !fivePossible(state.board, color, 'empty', SIZE))
  if (state.active.length > 1 && !deadDraw) return state
  return { ...state, phase: 'over', ranking: [...state.ranking, ...state.active], active: [] }
}

export function settleMelee(state: MeleeState, choices: MeleeChoices): MeleeState {
  if (state.phase !== 'playing') throw new Error('game is over')
  const byPoint = new Map<number, Color[]>()
  for (const color of state.active) {
    const point = choices[color]
    if (!point) continue
    if (!isLegalMeleeChoice(state, color, point)) throw new Error(`illegal choice for ${color}`)
    const i = point.y * SIZE + point.x
    byPoint.set(i, [...(byPoint.get(i) ?? []), color])
  }

  const board = [...state.board]
  const collisions: number[] = []
  const placed: { color: Color; point: Point }[] = []
  for (const [i, colors] of byPoint) {
    if (colors.length > 1) {
      board[i] = 'forbidden'
      collisions.push(i)
    } else {
      board[i] = colors[0]
      placed.push({ color: colors[0], point: toPoint(i) })
    }
  }

  const toCell = (i: number): MeleeClearedCell => ({ ...toPoint(i), cell: board[i] })
  const cleared: MeleeClearedGroup[] = []
  const finishers = placed
    .map(({ color, point }) => ({ color, point, lines: winningLines(board, color, point, SIZE) }))
    .filter(({ lines }) => lines.length)

  let ranking = state.ranking
  let active = state.active
  let winning: number[][] = []
  if (finishers.length > 1) {
    // 多人同帧连五：如双人对战的「同五两消」，各自的连线一起消失，谁也不算完赛。
    for (const { point, lines } of finishers) {
      const cells = [...new Set(lines.flat())]
      cleared.push({ origin: point, cells: cells.map(toCell) })
      for (const i of cells) board[i] = 'empty'
    }
  } else if (finishers.length === 1) {
    const [{ color, lines }] = finishers
    ranking = [...ranking, color]
    active = active.filter((c) => c !== color)
    winning = lines
  }

  for (const i of collisions) {
    const runs = winningLines(board, 'forbidden', toPoint(i), SIZE)
    for (const run of runs) cleared.push({ origin: toPoint(i), cells: run.map(toCell) })
    for (const j of runs.flat()) board[j] = 'empty'
  }

  const lastMoves = [...placed.map(({ point }) => point), ...collisions.map(toPoint)].filter(
    (p) => board[p.y * SIZE + p.x] !== 'empty',
  )

  return finish({
    ...state,
    board,
    frame: state.frame + 1,
    active,
    ranking,
    cleared,
    lastMoves,
    winningLines: winning.map((line) => line.map(toPoint)),
  })
}

// 中途退出/认输：离场不入榜，剩下的人照常继续。
export function dropOut(state: MeleeState, color: Color): MeleeState {
  if (state.phase !== 'playing' || !state.active.includes(color)) return state
  return finish({
    ...state,
    active: state.active.filter((c) => c !== color),
    out: [...state.out, color],
    cleared: [],
    winningLines: [],
  })
}
