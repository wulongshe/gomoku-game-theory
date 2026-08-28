import { describe, expect, it } from 'vitest'
import { searchBestMove } from '@/engine/mcts'
import {
  BOARD_SIZE,
  createGame,
  inOpeningArea,
  isLegalChoice,
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

describe('searchBestMove', () => {
  it('stays inside the opening area in frame 1', () => {
    const move = searchBestMove(createGame(), 'white', 'easy', 120)
    expect(move).not.toBeNull()
    expect(inOpeningArea(move!)).toBe(true)
  })

  it('always returns a legal move mid-game', () => {
    const game = withStones({ black: row(7, [6, 7, 8]), white: row(8, [6, 7]) })
    for (let i = 0; i < 20; i++) {
      const move = searchBestMove(game, 'white', 'easy', 60)
      expect(move).not.toBeNull()
      expect(isLegalChoice(game, move!)).toBe(true)
    }
  })

  it('returns null when no legal point remains', () => {
    const game = createGame()
    game.frame = 2
    game.board.fill('forbidden')
    expect(searchBestMove(game, 'black', 'easy', 60)).toBeNull()
  })

  // 黑四（4,5,6,7）左端被白 (3,7) 堵死，唯一胜点 (8,7)；白不撞掉即负，是被逼的唯一防守手。
  it('denies the opponent’s only winning point', () => {
    let denied = 0
    for (let i = 0; i < 10; i++) {
      const game = withStones({ black: row(7, [4, 5, 6, 7]), white: [{ x: 3, y: 7 }] })
      const move = searchBestMove(game, 'white', 'hard', 150)
      if (move?.x === 8 && move?.y === 7) denied++
    }
    expect(denied).toBeGreaterThan(7)
  })

  it('respects the time budget', () => {
    const game = withStones({ black: row(7, [6, 7, 8]), white: row(8, [6, 7]) })
    const start = performance.now()
    searchBestMove(game, 'white', 'hard', 150)
    expect(performance.now() - start).toBeLessThan(600)
  })

  // 大师用遗憾匹配：平均策略应收敛到唯一非受控防守手（撞掉黑的唯一胜点 (8,7)）。
  it('master denies the opponent’s only winning point', () => {
    let denied = 0
    for (let i = 0; i < 10; i++) {
      const game = withStones({ black: row(7, [4, 5, 6, 7]), white: [{ x: 3, y: 7 }] })
      const move = searchBestMove(game, 'white', 'master', 350)
      if (move?.x === 8 && move?.y === 7) denied++
    }
    expect(denied).toBeGreaterThan(6)
  })

  it('master completes its only winning point', () => {
    const game = withStones({ white: row(7, [4, 5, 6, 7]), black: [{ x: 3, y: 7 }] })
    const move = searchBestMove(game, 'white', 'master', 1)
    expect(move).toEqual({ x: 8, y: 7 })
    const next = settleFrame(game, { black: null, white: move })
    expect(next.phase).toBe('white_won')
  })

  it('master always returns a legal move mid-game', () => {
    const game = withStones({ black: row(7, [6, 7, 8]), white: row(8, [6, 7]) })
    for (let i = 0; i < 10; i++) {
      const move = searchBestMove(game, 'white', 'master', 60)
      expect(move).not.toBeNull()
      expect(isLegalChoice(game, move!)).toBe(true)
    }
  })
})
