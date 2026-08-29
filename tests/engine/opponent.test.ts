import { describe, expect, it } from 'vitest'
import { DEFAULT_BLOCK_RATE, observeBlock } from '@/engine/opponent'
import { winningPoints } from '@/engine/eval'
import { BOARD_SIZE, createGame, type GameState, type Point, type Seat } from '@/engine/game'

function withStones(stones: Partial<Record<Seat, Point[]>>): GameState {
  const game = createGame('forbidden')
  game.frame = 2
  for (const seat of ['black', 'white'] as const)
    for (const { x, y } of stones[seat] ?? []) game.board[y * BOARD_SIZE + x] = seat
  return game
}

const row = (y: number, xs: number[]): Point[] => xs.map((x) => ({ x, y }))

describe('winningPoints', () => {
  it('finds the completion point of a four', () => {
    const game = withStones({ white: row(7, [4, 5, 6, 7]), black: [{ x: 3, y: 7 }] })
    expect(winningPoints(game, 'white')).toEqual([{ x: 8, y: 7 }])
  })

  it('finds both ends of an open four', () => {
    const game = withStones({ white: row(7, [4, 5, 6, 7]) })
    expect(winningPoints(game, 'white')).toEqual([
      { x: 3, y: 7 },
      { x: 8, y: 7 },
    ])
  })

  it('is empty without an immediate win', () => {
    const game = withStones({ white: row(7, [6, 7, 8]) })
    expect(winningPoints(game, 'white')).toEqual([])
  })
})

describe('observeBlock', () => {
  const threat = withStones({ white: row(7, [4, 5, 6, 7]), black: [{ x: 3, y: 7 }] })

  it('rises toward 1 when the human occupies the winning point', () => {
    expect(observeBlock(DEFAULT_BLOCK_RATE, threat, { x: 8, y: 7 }, 'white')).toBeGreaterThan(
      DEFAULT_BLOCK_RATE,
    )
  })

  it('falls toward 0 when the human ignores the winning point', () => {
    expect(observeBlock(DEFAULT_BLOCK_RATE, threat, { x: 0, y: 0 }, 'white')).toBeLessThan(
      DEFAULT_BLOCK_RATE,
    )
  })

  it('leaves the rate unchanged when there was no threat to face', () => {
    const quiet = withStones({ white: row(7, [6, 7, 8]) })
    expect(observeBlock(DEFAULT_BLOCK_RATE, quiet, { x: 8, y: 7 }, 'white')).toBe(DEFAULT_BLOCK_RATE)
  })
})
