import { describe, expect, it } from 'vitest'
import {
  BOARD_SIZE,
  createGame,
  isLegalChoice,
  winningPoints,
  type CellState,
  type GameState,
  type Point,
  type Seat,
} from '@gomoku/engine/game'
import {
  BOARD_CODE_BYTES,
  challengeGame,
  challengeVerdict,
  decodeBoard,
  encodeBoard,
} from '@gomoku/engine/challenge'

function withStones(stones: Partial<Record<Seat, Point[]>>): GameState {
  const game = createGame()
  game.frame = 2
  for (const seat of ['black', 'white'] as const) {
    for (const { x, y } of stones[seat] ?? []) game.board[y * BOARD_SIZE + x] = seat
  }
  return game
}

const row = (y: number, from: number, to: number): Point[] =>
  Array.from({ length: to - from + 1 }, (_, i) => ({ x: from + i, y }))

describe('winningPoints', () => {
  it('lists both ends of an open four and nothing for a side without threats', () => {
    const game = withStones({ white: row(7, 3, 6) })
    expect(winningPoints(game, 'white')).toEqual([
      { x: 2, y: 7 },
      { x: 7, y: 7 },
    ])
    expect(winningPoints(game, 'black')).toEqual([])
  })

  it('ignores occupied ends', () => {
    const game = withStones({ white: row(7, 3, 6), black: [{ x: 2, y: 7 }] })
    expect(winningPoints(game, 'white')).toEqual([{ x: 7, y: 7 }])
  })
})

describe('challengeVerdict', () => {
  const blockedFour = { white: row(7, 3, 6), black: [{ x: 2, y: 7 }] }

  it('keeps playing while the opponent holds a single five-point', () => {
    expect(challengeVerdict(withStones(blockedFour))).toBe('playing')
  })

  it('succeeds once the challenger holds two five-points', () => {
    const game = withStones({ ...blockedFour, black: [{ x: 2, y: 7 }, ...row(10, 5, 8)] })
    expect(challengeVerdict(game)).toBe('success')
  })

  it('fails once the opponent holds two five-points, even if the challenger does too', () => {
    const game = withStones({ white: row(7, 3, 6), black: row(10, 5, 8) })
    expect(challengeVerdict(game)).toBe('fail')
  })

  it('maps game over to the verdict', () => {
    const won = withStones({})
    won.phase = 'black_won'
    expect(challengeVerdict(won)).toBe('success')
    const drawn = withStones({})
    drawn.phase = 'draw'
    expect(challengeVerdict(drawn)).toBe('fail')
  })
})

describe('board codec', () => {
  it('round-trips a four-state board through 57 bytes', () => {
    const cells: CellState[] = ['empty', 'black', 'white', 'forbidden']
    const board = Array.from({ length: BOARD_SIZE * BOARD_SIZE }, (_, i) => cells[(i * 7 + 3) % 4])
    const bytes = encodeBoard(board)
    expect(bytes).toHaveLength(57)
    expect(BOARD_CODE_BYTES).toBe(57)
    expect(decodeBoard(bytes)).toEqual(board)
  })

  it('rejects minus cells', () => {
    const board = createGame().board
    board[0] = 'minus'
    expect(() => encodeBoard(board)).toThrow()
  })

  it('opens a playable position past the opening restriction', () => {
    const board = withStones({ white: row(7, 3, 6), black: row(0, 0, 3) }).board
    board[BOARD_SIZE * BOARD_SIZE - 1] = 'forbidden'
    const game = challengeGame(board)
    expect(game.phase).toBe('playing')
    expect(game.mode).toBe('forbidden')
    expect(game.frame).toBe(6)
    expect(isLegalChoice(game, { x: 0, y: 14 })).toBe(true)
  })
})
