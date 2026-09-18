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
} from '@gomoku/engine/game'

function withStones(stones: Partial<Record<Seat, Point[]>>): GameState {
  const game = createGame()
  game.frame = 2
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
    expect(isLegalChoice(game, { x: 7, y: 6 })).toBe(true)
    expect(isLegalChoice(game, { x: -1, y: 0 })).toBe(false)
    expect(isLegalChoice(game, { x: 0, y: BOARD_SIZE })).toBe(false)
  })

  it('rejects occupied and forbidden points', () => {
    const game = withStones({ black: [{ x: 3, y: 3 }] })
    game.board[0] = 'forbidden'
    expect(isLegalChoice(game, { x: 3, y: 3 })).toBe(false)
    expect(isLegalChoice(game, { x: 0, y: 0 })).toBe(false)
  })

  it('restricts the first frame to the central 3x3 area minus the center', () => {
    const game = createGame()
    expect(isLegalChoice(game, { x: 6, y: 6 })).toBe(true)
    expect(isLegalChoice(game, { x: 8, y: 8 })).toBe(true)
    expect(isLegalChoice(game, { x: 7, y: 7 })).toBe(false)
    expect(isLegalChoice(game, { x: 5, y: 7 })).toBe(false)
    expect(isLegalChoice(game, { x: 0, y: 0 })).toBe(false)
    game.frame = 2
    expect(isLegalChoice(game, { x: 7, y: 7 })).toBe(true)
    expect(isLegalChoice(game, { x: 0, y: 0 })).toBe(true)
  })
})

describe('settleFrame', () => {
  it('places both stones and advances the frame', () => {
    const next = settleFrame(createGame(), { black: { x: 6, y: 7 }, white: { x: 8, y: 8 } })
    expect(cellAt(next, { x: 6, y: 7 })).toBe('black')
    expect(cellAt(next, { x: 8, y: 8 })).toBe('white')
    expect(next.phase).toBe('playing')
    expect(next.frame).toBe(2)
  })

  it('does not mutate the input state', () => {
    const game = createGame()
    settleFrame(game, { black: { x: 6, y: 7 }, white: { x: 8, y: 8 } })
    expect(cellAt(game, { x: 6, y: 7 })).toBe('empty')
    expect(game.frame).toBe(1)
  })

  it('turns a collision point into a forbidden cell with no stones', () => {
    const next = settleFrame(createGame(), { black: { x: 6, y: 6 }, white: { x: 6, y: 6 } })
    expect(cellAt(next, { x: 6, y: 6 })).toBe('forbidden')
    expect(next.phase).toBe('playing')
    expect(isLegalChoice(next, { x: 6, y: 6 })).toBe(false)
  })

  it('records every winning line through the final move', () => {
    const game = withStones({
      black: [
        ...[1, 2, 3, 4].map((i) => ({ x: i, y: 5 })),
        ...[1, 2, 3, 4].map((i) => ({ x: 5, y: i })),
      ],
    })
    const next = settleFrame(game, { black: { x: 5, y: 5 }, white: { x: 8, y: 8 } })
    expect(next.phase).toBe('black_won')
    expect(next.winningLines).toEqual([
      [1, 2, 3, 4, 5].map((i) => ({ x: i, y: 5 })),
      [1, 2, 3, 4, 5].map((i) => ({ x: 5, y: i })),
    ])
  })

  it('treats null as a pass, placing only the other stone', () => {
    const next = settleFrame(createGame(), { black: null, white: { x: 6, y: 6 } })
    expect(cellAt(next, { x: 6, y: 6 })).toBe('white')
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

  it('annihilates both lines when the two players complete five in the same frame', () => {
    const game = withStones({
      black: [0, 1, 2, 3].map((i) => ({ x: i, y: 0 })),
      white: [0, 1, 2, 3].map((i) => ({ x: i, y: 14 })),
    })
    const next = settleFrame(game, { black: { x: 4, y: 0 }, white: { x: 4, y: 14 } })
    expect(next.phase).toBe('playing')
    for (let x = 0; x <= 4; x++) {
      expect(cellAt(next, { x, y: 0 })).toBe('empty')
      expect(cellAt(next, { x, y: 14 })).toBe('empty')
    }
    expect(next.cleared).toEqual([
      {
        origin: { x: 4, y: 0 },
        cells: expect.arrayContaining([{ x: 0, y: 0, cell: 'black' }]),
      },
      {
        origin: { x: 4, y: 14 },
        cells: expect.arrayContaining([{ x: 0, y: 14, cell: 'white' }]),
      },
    ])
    expect(next.cleared[0].cells).toHaveLength(5)
    expect(next.cleared[1].cells).toHaveLength(5)
  })

  it('annihilates every direction that reaches five, not just the first', () => {
    const game = withStones({
      black: [
        ...[3, 4, 5, 6].map((x) => ({ x, y: 7 })),
        ...[3, 4, 5, 6].map((y) => ({ x: 7, y })),
        ...[3, 4, 5, 6].map((i) => ({ x: i, y: i })),
      ],
      white: [0, 1, 2, 3].map((x) => ({ x, y: 14 })),
    })
    const next = settleFrame(game, { black: { x: 7, y: 7 }, white: { x: 4, y: 14 } })
    expect(next.phase).toBe('playing')
    for (let i = 3; i <= 7; i++) {
      expect(cellAt(next, { x: i, y: 7 })).toBe('empty')
      expect(cellAt(next, { x: 7, y: i })).toBe('empty')
      expect(cellAt(next, { x: i, y: i })).toBe('empty')
    }
    for (let x = 0; x <= 4; x++) expect(cellAt(next, { x, y: 14 })).toBe('empty')
  })

  it('clears a line of five forbidden points', () => {
    const game = createGame()
    game.frame = 2
    for (let x = 0; x < 4; x++) game.board[x] = 'forbidden'
    const next = settleFrame(game, { black: { x: 4, y: 0 }, white: { x: 4, y: 0 } })
    expect(next.phase).toBe('playing')
    for (let x = 0; x <= 4; x++) expect(cellAt(next, { x, y: 0 })).toBe('empty')
  })

  it('clears each forbidden line as its own group when a collision completes several', () => {
    const game = createGame()
    game.frame = 2
    for (let x = 0; x < 4; x++) game.board[x] = 'forbidden'
    for (let y = 1; y <= 4; y++) game.board[y * BOARD_SIZE + 4] = 'forbidden'
    const next = settleFrame(game, { black: { x: 4, y: 0 }, white: { x: 4, y: 0 } })
    expect(next.phase).toBe('playing')
    for (let x = 0; x <= 4; x++) expect(cellAt(next, { x, y: 0 })).toBe('empty')
    for (let y = 1; y <= 4; y++) expect(cellAt(next, { x: 4, y })).toBe('empty')
    expect(next.cleared).toHaveLength(2)
    for (const group of next.cleared) {
      expect(group.origin).toMatchObject({ x: 4, y: 0 })
      expect(group.cells).toHaveLength(5)
    }
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

  it('declares a draw when the board fills up without a winning line', () => {
    const game = createGame()
    game.frame = 2
    const color = (x: number, y: number): Seat => ((2 * x + y) % 5 < 3 ? 'black' : 'white')
    for (let y = 0; y < BOARD_SIZE; y++) {
      for (let x = 0; x < BOARD_SIZE; x++) game.board[y * BOARD_SIZE + x] = color(x, y)
    }
    game.board[0 * BOARD_SIZE + 0] = 'empty'
    game.board[0 * BOARD_SIZE + 2] = 'empty'
    const next = settleFrame(game, { black: { x: 0, y: 0 }, white: { x: 2, y: 0 } })
    expect(next.phase).toBe('draw')
  })


  // (2x+y)%5<3 花纹：任何方向的五窗都黑白混杂，单个空点四周也拼不出净五连。
  function deadPattern(): GameState {
    const game = createGame()
    game.frame = 2
    for (let y = 0; y < BOARD_SIZE; y++) {
      for (let x = 0; x < BOARD_SIZE; x++) {
        game.board[y * BOARD_SIZE + x] = (2 * x + y) % 5 < 3 ? 'black' : 'white'
      }
    }
    return game
  }

  it('declares a draw once no side can ever reach five', () => {
    const game = deadPattern()
    game.board[0] = 'empty'
    expect(game.board.filter((c) => c === 'empty')).toHaveLength(1)
    const next = settleFrame(game, { black: null, white: null })
    expect(next.phase).toBe('draw')
  })

  it('keeps the game alive while the forbidden cells can still reach five', () => {
    const game = deadPattern()
    for (let x = 0; x < 4; x++) game.board[x] = 'forbidden'
    game.board[4] = 'empty'
    const next = settleFrame(game, { black: null, white: null })
    expect(next.phase).toBe('playing')
  })

  it('sees a potential forbidden five needing several new collisions', () => {
    const game = deadPattern()
    game.board[0] = 'forbidden'
    game.board[1] = 'forbidden'
    game.board[2] = 'empty'
    game.board[3] = 'empty'
    game.board[4] = 'forbidden'
    const next = settleFrame(game, { black: null, white: null })
    expect(next.phase).toBe('playing')
  })

  it('does not declare a dead draw while a player still has room for five', () => {
    const game = deadPattern()
    for (let x = 0; x < 5; x++) game.board[x] = 'empty'
    game.board[0] = 'black'
    const next = settleFrame(game, { black: null, white: null })
    expect(next.phase).toBe('playing')
  })

  it('rejects illegal choices and settled games', () => {
    const game = withStones({ black: [{ x: 7, y: 7 }] })
    expect(() => settleFrame(game, { black: { x: 7, y: 7 }, white: null })).toThrow()
    expect(() => settleFrame(game, { black: null, white: { x: 15, y: 0 } })).toThrow()
    const over: GameState = { ...createGame(), phase: 'black_won' }
    expect(() => settleFrame(over, { black: null, white: null })).toThrow()
  })
})
