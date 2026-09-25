import { describe, expect, it } from 'vitest'
import {
  createMelee,
  dropOut,
  isLegalMeleeChoice,
  MELEE_BOARD_SIZE,
  meleeCellAt,
  settleMelee,
  type Color,
  type MeleeState,
} from '@gomoku/engine/melee'
import type { Point } from '@gomoku/engine/game'

const N = MELEE_BOARD_SIZE

function withStones(
  players: Color[],
  stones: Partial<Record<Color, Point[]>>,
  frame = 2,
): MeleeState {
  const game = createMelee(players)
  game.frame = frame
  for (const color of players) {
    for (const { x, y } of stones[color] ?? []) game.board[y * N + x] = color
  }
  return game
}

const row = (y: number, xs: number[]) => xs.map((x) => ({ x, y }))

describe('createMelee', () => {
  it('starts everyone active on an empty 19x19 board', () => {
    const game = createMelee(['black', 'white', 'purple'])
    expect(game.board).toHaveLength(N * N)
    expect(game.active).toEqual(['black', 'white', 'purple'])
    expect(game.ranking).toEqual([])
  })
})

describe('isLegalMeleeChoice', () => {
  it('restricts the first frame to the central 3x3 minus the center', () => {
    const game = createMelee(['black', 'white', 'purple'])
    expect(isLegalMeleeChoice(game, 'black', { x: 9, y: 9 })).toBe(false)
    expect(isLegalMeleeChoice(game, 'black', { x: 8, y: 9 })).toBe(true)
    expect(isLegalMeleeChoice(game, 'black', { x: 10, y: 10 })).toBe(true)
    expect(isLegalMeleeChoice(game, 'black', { x: 11, y: 10 })).toBe(false)
    expect(isLegalMeleeChoice(game, 'black', { x: 0, y: 0 })).toBe(false)
  })

  it('rejects colors that are not active', () => {
    const game = withStones(['black', 'white', 'purple'], {})
    expect(isLegalMeleeChoice(game, 'yellow', { x: 3, y: 3 })).toBe(false)
    const out = dropOut(game, 'purple')
    expect(isLegalMeleeChoice(out, 'purple', { x: 3, y: 3 })).toBe(false)
  })
})

describe('settleMelee', () => {
  it('places every distinct stone and forbids each collision point', () => {
    const game = withStones(['black', 'white', 'purple', 'yellow'], {})
    const next = settleMelee(game, {
      black: { x: 5, y: 5 },
      white: { x: 5, y: 5 },
      purple: { x: 8, y: 8 },
      yellow: null,
    })
    expect(meleeCellAt(next, { x: 5, y: 5 })).toBe('forbidden')
    expect(meleeCellAt(next, { x: 8, y: 8 })).toBe('purple')
    expect(next.frame).toBe(3)
    expect(next.lastMoves).toEqual([{ x: 8, y: 8 }, { x: 5, y: 5 }])
  })

  it('ranks the first finisher, keeps their stones and lets the rest play on', () => {
    const game = withStones(['black', 'white', 'purple'], { purple: row(3, [1, 2, 3, 4]) })
    const next = settleMelee(game, {
      black: { x: 10, y: 10 },
      white: { x: 11, y: 11 },
      purple: { x: 5, y: 3 },
    })
    expect(next.phase).toBe('playing')
    expect(next.ranking).toEqual(['purple'])
    expect(next.active).toEqual(['black', 'white'])
    expect(next.winningLines).toEqual([row(3, [1, 2, 3, 4, 5])])
    expect(meleeCellAt(next, { x: 5, y: 3 })).toBe('purple')
    expect(isLegalMeleeChoice(next, 'purple', { x: 18, y: 18 })).toBe(false)
  })

  it('ends when the second-to-last finisher leaves one player, who comes last', () => {
    const game = withStones(['black', 'white', 'purple'], {
      purple: row(3, [1, 2, 3, 4]),
      white: row(9, [1, 2, 3, 4]),
    })
    const two = settleMelee(game, { black: { x: 10, y: 10 }, white: null, purple: { x: 5, y: 3 } })
    const done = settleMelee(two, { black: { x: 11, y: 11 }, white: { x: 5, y: 9 } })
    expect(done.phase).toBe('over')
    expect(done.ranking).toEqual(['purple', 'white', 'black'])
    expect(done.active).toEqual([])
  })

  it('annihilates the lines when several players finish in the same frame', () => {
    const game = withStones(['black', 'white', 'purple'], {
      purple: row(3, [1, 2, 3, 4]),
      white: row(9, [1, 2, 3, 4]),
    })
    const next = settleMelee(game, { black: null, white: { x: 5, y: 9 }, purple: { x: 5, y: 3 } })
    expect(next.phase).toBe('playing')
    expect(next.ranking).toEqual([])
    expect(next.active).toEqual(['black', 'white', 'purple'])
    expect(next.cleared).toHaveLength(2)
    for (const x of [1, 2, 3, 4, 5]) {
      expect(meleeCellAt(next, { x, y: 3 })).toBe('empty')
      expect(meleeCellAt(next, { x, y: 9 })).toBe('empty')
    }
  })

  it('clears a forbidden five through a collision point', () => {
    const game = withStones(['black', 'white', 'purple'], {})
    for (const x of [1, 2, 3, 4]) game.board[6 * N + x] = 'forbidden'
    const next = settleMelee(game, { black: { x: 5, y: 6 }, white: { x: 5, y: 6 }, purple: null })
    for (const x of [1, 2, 3, 4, 5]) expect(meleeCellAt(next, { x, y: 6 })).toBe('empty')
    expect(next.cleared).toHaveLength(1)
  })

  it('rejects choices from finished players and illegal points', () => {
    const game = withStones(['black', 'white', 'purple'], { purple: row(3, [1, 2, 3, 4]) })
    const next = settleMelee(game, { black: null, white: null, purple: { x: 5, y: 3 } })
    expect(() => settleMelee(next, { black: { x: 5, y: 3 } })).toThrow()
    expect(() => settleMelee(next, { black: { x: 30, y: 3 } })).toThrow()
    // 已完赛者的选择被忽略而非报错：DO 侧不会再收，引擎层只认 active。
    expect(() => settleMelee(next, { purple: { x: 9, y: 9 }, black: { x: 8, y: 8 } })).not.toThrow()
  })
})

describe('dropOut', () => {
  it('removes the player without ranking them and keeps the game going', () => {
    const game = withStones(['black', 'white', 'purple'], {})
    const next = dropOut(game, 'white')
    expect(next.phase).toBe('playing')
    expect(next.active).toEqual(['black', 'purple'])
    expect(next.out).toEqual(['white'])
    expect(next.ranking).toEqual([])
  })

  it('ends the game when only one player is left', () => {
    const game = withStones(['black', 'white', 'purple'], {})
    const next = dropOut(dropOut(game, 'white'), 'purple')
    expect(next.phase).toBe('over')
    expect(next.ranking).toEqual(['black'])
  })
})
