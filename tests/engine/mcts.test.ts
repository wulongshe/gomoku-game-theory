import { describe, expect, it } from 'vitest'
import { prepareSearch, searchBestMove } from '@gomoku/engine/mcts'
import {
  BOARD_SIZE,
  createGame,
  inOpeningArea,
  isLegalChoice,
  type GameMode,
  type GameState,
  type Point,
  type Seat,
} from '@gomoku/engine/game'

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
    const move = searchBestMove(createGame(), 'white', 'easy', 120).point
    expect(move).not.toBeNull()
    expect(inOpeningArea(move!)).toBe(true)
  })

  it('always returns a legal move mid-game', () => {
    const game = withStones({ black: row(7, [6, 7, 8]), white: row(8, [6, 7]) })
    for (let i = 0; i < 20; i++) {
      const move = searchBestMove(game, 'white', 'easy', 60).point
      expect(move).not.toBeNull()
      expect(isLegalChoice(game, move!)).toBe(true)
    }
  })

  it('returns null when no legal point remains', () => {
    const game = createGame()
    game.frame = 2
    game.board.fill('forbidden')
    expect(searchBestMove(game, 'black', 'easy', 60).point).toBeNull()
  })

  // 黑四（4,5,6,7）左端被白 (3,7) 堵死，唯一胜点 (8,7)；白不撞掉即负，是被逼的唯一防守手。
  it('denies the opponent’s only winning point', () => {
    let denied = 0
    for (let i = 0; i < 10; i++) {
      const game = withStones({ black: row(7, [4, 5, 6, 7]), white: [{ x: 3, y: 7 }] })
      const move = searchBestMove(game, 'white', 'hard', 150).point
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

  // 白活四（4~7）两端皆可成五，任一端都是取胜手。
  it('takes its own win when one is available', () => {
    const game = withStones({ white: row(7, [4, 5, 6, 7]) })
    const move = searchBestMove(game, 'white', 'master', 150).point
    expect(move?.y).toBe(7)
    expect([3, 8]).toContain(move?.x)
  })

  it('reports iterations for throughput-adaptive callers', () => {
    const game = withStones({ black: row(7, [6, 7, 8]), white: row(8, [6, 7]) })
    const { iterations } = searchBestMove(game, 'white', 'easy', 60)
    expect(iterations).toBeGreaterThan(0)
  })

  // 分片跑（无 Worker 的主线程调度）：多片累计与一次跑满同样给出合法手，且迭代数随片累加。
  it('accumulates iterations across sliced runs', () => {
    const game = withStones({ black: row(7, [6, 7, 8]), white: row(8, [6, 7]) })
    const search = prepareSearch(game, 'white', 'hard')
    expect(search.budgetMs).toBeGreaterThan(0)
    expect(search.run(30)).toBe(false)
    const first = search.result().iterations
    search.run(30)
    const { point, iterations } = search.result()
    expect(iterations).toBeGreaterThan(first)
    expect(isLegalChoice(game, point!)).toBe(true)
  })

  it('reports a trivial search as done without running', () => {
    const game = withStones({ white: row(7, [4, 5, 6, 7]) })
    const search = prepareSearch(createGame(), 'white', 'easy')
    expect(search.run(10)).toBe(false)
    expect(prepareSearch({ ...game, phase: 'white_won' }, 'white', 'easy').run(10)).toBe(true)
  })
})
