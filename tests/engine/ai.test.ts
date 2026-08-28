import { describe, expect, it } from 'vitest'
import { chooseAiMove } from '@/engine/ai'
import {
  BOARD_SIZE,
  createGame,
  inOpeningArea,
  settleFrame,
  type GameMode,
  type GameState,
  type Point,
  type Seat,
} from '@/engine/game'

function withStones(stones: Partial<Record<Seat, Point[]>>, mode: GameMode = 'forbidden'): GameState {
  const game = createGame(mode)
  game.frame = 2
  for (const seat of ['black', 'white'] as const) {
    for (const { x, y } of stones[seat] ?? []) {
      game.board[y * BOARD_SIZE + x] = seat
    }
  }
  return game
}

const row = (y: number, xs: number[]): Point[] => xs.map((x) => ({ x, y }))

describe('chooseAiMove', () => {
  it('completes an open four into five', () => {
    const game = withStones({ black: row(7, [4, 5, 6, 7]) })
    const move = chooseAiMove(game, 'black')
    expect([
      { x: 3, y: 7 },
      { x: 8, y: 7 },
    ]).toContainEqual(move)
    const next = settleFrame(game, { black: move, white: null })
    expect(next.phase).toBe('black_won')
  })

  it('blocks the opponent open four', () => {
    const game = withStones({ white: row(7, [4, 5, 6, 7]) })
    const move = chooseAiMove(game, 'black')
    expect([
      { x: 3, y: 7 },
      { x: 8, y: 7 },
    ]).toContainEqual(move)
  })

  it('prefers its own win over blocking', () => {
    const game = withStones({ black: row(5, [4, 5, 6, 7]), white: row(9, [4, 5, 6, 7]) })
    const move = chooseAiMove(game, 'black')
    expect(move?.y).toBe(5)
  })

  it('stays inside the opening area in frame 1', () => {
    const move = chooseAiMove(createGame(), 'white')
    expect(move).not.toBeNull()
    expect(inOpeningArea(move!)).toBe(true)
  })

  it('returns null when no legal point remains', () => {
    const game = createGame()
    game.frame = 2
    game.board.fill('forbidden')
    expect(chooseAiMove(game, 'black')).toBeNull()
  })
})
