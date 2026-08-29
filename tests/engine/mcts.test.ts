import { describe, expect, it } from 'vitest'
import { searchBestMove } from '@/engine/mcts'
import {
  BOARD_SIZE,
  createGame,
  inOpeningArea,
  isLegalChoice,
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

  it('master always returns a legal move mid-game', () => {
    const game = withStones({ black: row(7, [6, 7, 8]), white: row(8, [6, 7]) })
    for (let i = 0; i < 10; i++) {
      const move = searchBestMove(game, 'white', 'master', 60)
      expect(move).not.toBeNull()
      expect(isLegalChoice(game, move!)).toBe(true)
    }
  })

  // 机会性终结：白四（4..7,row7）左端被 (3,7) 堵，唯一胜点 (8,7)。对手不常堵（低封堵率）时应直接兑现。
  it('master cashes a simple four against a non-blocking opponent', () => {
    const game = withStones({ white: row(7, [4, 5, 6, 7]), black: [{ x: 3, y: 7 }] })
    const move = searchBestMove(game, 'white', 'master', 120, 0.1)
    expect(move).toEqual({ x: 8, y: 7 })
  })

  // 对手稳堵（高封堵率）时不该往撞点上送单胜点四子，转而保留威胁继续发展。
  it('master keeps a simple four latent against a reliable blocker', () => {
    let shot = 0
    for (let i = 0; i < 10; i++) {
      const game = withStones({ white: row(7, [4, 5, 6, 7]), black: [{ x: 3, y: 7 }] })
      const move = searchBestMove(game, 'white', 'master', 120, 0.95)
      if (move?.x === 8 && move?.y === 7) shot++
    }
    expect(shot).toBeLessThan(4)
  })

  // 活四两端皆胜点，对手每帧至多撞一个，撞不全 —— 即便面对稳堵也该出手兑现。
  it('master cashes an open four even against a reliable blocker', () => {
    const game = withStones({ white: row(7, [4, 5, 6, 7]) })
    const move = searchBestMove(game, 'white', 'master', 120, 0.95)
    expect([
      { x: 3, y: 7 },
      { x: 8, y: 7 },
    ]).toContainEqual(move)
  })
})
