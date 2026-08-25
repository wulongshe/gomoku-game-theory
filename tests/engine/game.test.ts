import { describe, expect, it } from 'vitest'
import {
  BOARD_SIZE,
  cellAt,
  createGame,
  isLegalChoice,
  settleFrame,
  type GameState,
  type Point,
  type Seat,
} from '@/engine/game'

function withStones(stones: Partial<Record<Seat, Point[]>>): GameState {
  const game = createGame()
  for (const seat of ['black', 'white'] as const) {
    for (const { x, y } of stones[seat] ?? []) {
      game.board[y * BOARD_SIZE + x] = seat
    }
  }
  return game
}

describe('createGame', () => {
  it('starts with an empty board in frame 1', () => {
    const game = createGame()
    expect(game.board).toHaveLength(BOARD_SIZE * BOARD_SIZE)
    expect(game.board.every((cell) => cell === 'empty')).toBe(true)
    expect(game.phase).toBe('playing')
    expect(game.frame).toBe(1)
  })
})

describe('isLegalChoice', () => {
  it('accepts empty in-bounds points and rejects out-of-bounds ones', () => {
    const game = createGame()
    expect(isLegalChoice(game, { x: 7, y: 7 })).toBe(true)
    expect(isLegalChoice(game, { x: -1, y: 0 })).toBe(false)
    expect(isLegalChoice(game, { x: 0, y: BOARD_SIZE })).toBe(false)
  })

  it('rejects occupied and forbidden points', () => {
    const game = withStones({ black: [{ x: 3, y: 3 }] })
    game.board[0] = 'forbidden'
    expect(isLegalChoice(game, { x: 3, y: 3 })).toBe(false)
    expect(isLegalChoice(game, { x: 0, y: 0 })).toBe(false)
  })
})

describe('settleFrame', () => {
  it('places both stones and advances the frame', () => {
    const next = settleFrame(createGame(), { black: { x: 7, y: 7 }, white: { x: 8, y: 8 } })
    expect(cellAt(next, { x: 7, y: 7 })).toBe('black')
    expect(cellAt(next, { x: 8, y: 8 })).toBe('white')
    expect(next.phase).toBe('playing')
    expect(next.frame).toBe(2)
  })

  it('does not mutate the input state', () => {
    const game = createGame()
    settleFrame(game, { black: { x: 7, y: 7 }, white: { x: 8, y: 8 } })
    expect(cellAt(game, { x: 7, y: 7 })).toBe('empty')
    expect(game.frame).toBe(1)
  })

  it('turns a collision point into a forbidden cell with no stones', () => {
    const next = settleFrame(createGame(), { black: { x: 7, y: 7 }, white: { x: 7, y: 7 } })
    expect(cellAt(next, { x: 7, y: 7 })).toBe('forbidden')
    expect(next.phase).toBe('playing')
    expect(isLegalChoice(next, { x: 7, y: 7 })).toBe(false)
  })

  it('treats null as a pass, placing only the other stone', () => {
    const next = settleFrame(createGame(), { black: null, white: { x: 0, y: 0 } })
    expect(cellAt(next, { x: 0, y: 0 })).toBe('white')
    expect(next.board.filter((cell) => cell !== 'empty')).toHaveLength(1)
  })

  it.each([
    ['horizontal', (i: number): Point => ({ x: 3 + i, y: 7 })],
    ['vertical', (i: number): Point => ({ x: 7, y: 3 + i })],
    ['diagonal ↘', (i: number): Point => ({ x: 3 + i, y: 3 + i })],
    ['diagonal ↗', (i: number): Point => ({ x: 3 + i, y: 11 - i })],
  ])('detects a %s five completed in the middle', (_name, at) => {
    const game = withStones({ black: [at(0), at(1), at(3), at(4)] })
    const next = settleFrame(game, { black: at(2), white: { x: 14, y: 0 } })
    expect(next.phase).toBe('black_won')
  })

  it('declares a draw when both complete five in the same frame without a first mover', () => {
    const game = withStones({
      black: [0, 1, 2, 3].map((i) => ({ x: i, y: 0 })),
      white: [0, 1, 2, 3].map((i) => ({ x: i, y: 14 })),
    })
    const next = settleFrame(game, { black: { x: 4, y: 0 }, white: { x: 4, y: 14 } })
    expect(next.phase).toBe('draw')
  })

  it('awards the frame to whoever submitted first when both complete five', () => {
    const game = withStones({
      black: [0, 1, 2, 3].map((i) => ({ x: i, y: 0 })),
      white: [0, 1, 2, 3].map((i) => ({ x: i, y: 14 })),
    })
    const choices = { black: { x: 4, y: 0 }, white: { x: 4, y: 14 } }
    expect(settleFrame(game, choices, 'white').phase).toBe('white_won')
    expect(settleFrame(game, choices, 'black').phase).toBe('black_won')
  })

  it('awards no win when the winning point collides', () => {
    const game = withStones({ black: [0, 1, 2, 3].map((i) => ({ x: i, y: 0 })) })
    const next = settleFrame(game, { black: { x: 4, y: 0 }, white: { x: 4, y: 0 } })
    expect(next.phase).toBe('playing')
    expect(cellAt(next, { x: 4, y: 0 })).toBe('forbidden')
  })

  it('does not count a five interrupted by a forbidden cell', () => {
    const game = withStones({ black: [0, 1, 3, 4].map((i) => ({ x: i, y: 0 })) })
    game.board[2] = 'forbidden'
    const next = settleFrame(game, { black: { x: 5, y: 0 }, white: null })
    expect(next.phase).toBe('playing')
  })

  it('declares a draw when the board is exhausted without a winner', () => {
    const game = createGame()
    game.board.fill('forbidden')
    game.board[0] = 'empty'
    game.board[1] = 'empty'
    const next = settleFrame(game, { black: { x: 0, y: 0 }, white: { x: 1, y: 0 } })
    expect(next.phase).toBe('draw')
  })

  it('rejects illegal choices and settled games', () => {
    const game = withStones({ black: [{ x: 7, y: 7 }] })
    expect(() => settleFrame(game, { black: { x: 7, y: 7 }, white: null })).toThrow()
    expect(() => settleFrame(game, { black: null, white: { x: 15, y: 0 } })).toThrow()
    const over: GameState = { ...createGame(), phase: 'black_won' }
    expect(() => settleFrame(over, { black: null, white: null })).toThrow()
  })
})
