import { describe, expect, it } from 'vitest'
import { quiescenceValue, type QuiescenceOptions } from '@/engine/quiescence'
import { searchBestMove } from '@/engine/mcts'
import {
  BOARD_SIZE,
  createGame,
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
const Q: QuiescenceOptions = { candidates: 4, maxDepth: 2 }

describe('quiescenceValue', () => {
  // 黑活四（3,4,5,6）两端 (2,7)/(7,7) 皆成五：同时落子下对手每帧只能撞掉一端 → 强但非必胜（猜点），
  // 应落在 (0,1) 开区间内、明显高于均势又严格小于确定胜（=1）。
  it('scores an open four as winning-but-not-certain under simultaneous blocking', () => {
    const game = withStones({ black: row(7, [3, 4, 5, 6]) })
    const v = quiescenceValue(game, 'black', Q)
    expect(v).toBeGreaterThan(0.3)
    expect(v).toBeLessThan(1)
  })

  // 同一局面对被威胁方（白）而言是劣势，符号必为负。
  it('is sign-consistent: the threatened side sees the same position as losing', () => {
    const game = withStones({ black: row(7, [3, 4, 5, 6]) })
    expect(quiescenceValue(game, 'white', Q)).toBeLessThan(-0.1)
  })

  // 无冲四以上威胁的平静局面直接回退静态评估，量级应接近均势。
  it('returns a near-zero score for a quiet, balanced position', () => {
    const game = withStones({ black: [{ x: 7, y: 7 }], white: [{ x: 7, y: 8 }] })
    expect(Math.abs(quiescenceValue(game, 'black', Q))).toBeLessThan(0.5)
  })
})

describe('searchBestMove with quiescence', () => {
  // 黑四（4,5,6,7）左端被白 (3,7) 堵死，唯一胜点 (8,7)；静止搜索应看穿不撞即负，稳定选 (8,7)。
  it('still denies the opponent’s only winning point', () => {
    let denied = 0
    for (let i = 0; i < 10; i++) {
      const game = withStones({ black: row(7, [4, 5, 6, 7]), white: [{ x: 3, y: 7 }] })
      const move = searchBestMove(game, 'white', 'hard', 200, { quiescence: Q })
      if (move?.x === 8 && move?.y === 7) denied++
    }
    expect(denied).toBeGreaterThan(6)
  })

  it('returns a legal move mid-game', () => {
    const game = withStones({ black: row(7, [6, 7, 8]), white: row(8, [6, 7]) })
    for (let i = 0; i < 10; i++) {
      const move = searchBestMove(game, 'white', 'master', 120, { quiescence: Q })
      expect(move).not.toBeNull()
      expect(isLegalChoice(game, move!)).toBe(true)
    }
  })
})
