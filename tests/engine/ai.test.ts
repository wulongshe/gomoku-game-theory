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
    const move = chooseAiMove(game, 'black', 'hard')
    expect([
      { x: 3, y: 7 },
      { x: 8, y: 7 },
    ]).toContainEqual(move)
    const next = settleFrame(game, { black: move, white: null })
    expect(next.phase).toBe('black_won')
  })

  it('blocks the opponent open four', () => {
    const game = withStones({ white: row(7, [4, 5, 6, 7]) })
    const move = chooseAiMove(game, 'black', 'hard')
    expect([
      { x: 3, y: 7 },
      { x: 8, y: 7 },
    ]).toContainEqual(move)
  })

  it('prefers its own win over blocking', () => {
    const game = withStones({ black: row(5, [4, 5, 6, 7]), white: row(9, [4, 5, 6, 7]) })
    const move = chooseAiMove(game, 'black', 'hard')
    expect(move?.y).toBe(5)
  })

  it('stays inside the opening area in frame 1', () => {
    const move = chooseAiMove(createGame(), 'white', 'hard')
    expect(move).not.toBeNull()
    expect(inOpeningArea(move!)).toBe(true)
  })

  it('returns null when no legal point remains', () => {
    const game = createGame()
    game.frame = 2
    game.board.fill('forbidden')
    expect(chooseAiMove(game, 'black', 'hard')).toBeNull()
  })

  const MODES: GameMode[] = ['forbidden', 'minus']

  it.each(MODES)('completes its own five in %s mode', (mode) => {
    const game = withStones({ black: row(7, [4, 5, 6, 7]) }, mode)
    const move = chooseAiMove(game, 'black', 'hard')
    expect([
      { x: 3, y: 7 },
      { x: 8, y: 7 },
    ]).toContainEqual(move)
  })

  it.each(MODES)('contests the opponent winning point in %s mode', (mode) => {
    const game = withStones({ white: row(7, [4, 5, 6, 7]) }, mode)
    const move = chooseAiMove(game, 'black', 'hard')
    expect([
      { x: 3, y: 7 },
      { x: 8, y: 7 },
    ]).toContainEqual(move)
  })

  // ● ● ● [负子] ● ●：加权和已达 4，再落一子即达 5 获胜，负子在连线中间
  it('completes a win through a minus cell in its own line', () => {
    const game = withStones({ black: row(7, [4, 5, 6, 8, 9]) }, 'minus')
    game.board[7 * BOARD_SIZE + 7] = 'minus'
    const move = chooseAiMove(game, 'black', 'hard')
    const next = settleFrame(game, { black: move, white: null })
    expect(next.phase).toBe('black_won')
  })

  it('contests an opponent win that runs through a minus cell', () => {
    const game = withStones({ white: row(7, [4, 5, 6, 8, 9]) }, 'minus')
    game.board[7 * BOARD_SIZE + 7] = 'minus'
    const move = chooseAiMove(game, 'black', 'hard')
    expect([
      { x: 3, y: 7 },
      { x: 10, y: 7 },
    ]).toContainEqual(move)
  })

  it('mixes its play in a quiet position instead of being deterministic', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 30; i++) {
      const game = withStones({ black: [{ x: 7, y: 7 }], white: [{ x: 8, y: 8 }] })
      const move = chooseAiMove(game, 'white', 'easy')
      seen.add(`${move!.x},${move!.y}`)
    }
    expect(seen.size).toBeGreaterThan(1)
  })
})
