import { describe, expect, it } from 'vitest'
import { assessPosition, chooseAiMove, decideAiMove } from '@gomoku/engine/ai'
import { evaluateState } from '@gomoku/engine/eval'
import {
  BOARD_SIZE,
  createGame,
  inOpeningArea,
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

  it('completes its own five', () => {
    const game = withStones({ black: row(7, [4, 5, 6, 7]) })
    const move = chooseAiMove(game, 'black', 'hard')
    expect([
      { x: 3, y: 7 },
      { x: 8, y: 7 },
    ]).toContainEqual(move)
  })

  it('contests the opponent winning point', () => {
    const game = withStones({ white: row(7, [4, 5, 6, 7]) })
    const move = chooseAiMove(game, 'black', 'hard')
    expect([
      { x: 3, y: 7 },
      { x: 8, y: 7 },
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

  // 活四（两个胜点 (3,7)/(8,7)）对手撞不全，应比左端被堵、只剩单胜点的四明显更值钱。
  it('values a double threat above a single threat', () => {
    const doubleThreat = withStones({ white: row(7, [4, 5, 6, 7]) })
    const singleThreat = withStones({ white: row(7, [4, 5, 6, 7]), black: [{ x: 3, y: 7 }] })
    expect(evaluateState(doubleThreat, 'white')).toBeGreaterThan(evaluateState(singleThreat, 'white'))
  })
})

describe('decideAiMove', () => {
  it('reports zero criticality and a commanding stance when it can win', () => {
    const d = decideAiMove(withStones({ black: row(7, [4, 5, 6, 7]) }), 'black', 'hard')
    expect(d.criticality).toBe(0)
    expect(d.commanding).toBe(true)
    expect(d.losing).toBe(false)
  })

  it('flags a losing fork but not a single blockable threat', () => {
    const fork = decideAiMove(withStones({ white: row(7, [4, 5, 6, 7]) }), 'black', 'hard')
    expect(fork.losing).toBe(true)
    const single = decideAiMove(
      withStones({ white: row(7, [4, 5, 6, 7]), black: [{ x: 3, y: 7 }] }),
      'black',
      'hard',
    )
    expect(single.losing).toBe(false)
  })

  it('assessPosition reports the same stance without picking a move', () => {
    expect(assessPosition(withStones({ white: row(7, [4, 5, 6, 7]) }), 'black', 'hard')).toEqual({
      losing: true,
      commanding: false,
    })
    expect(assessPosition(withStones({ black: row(7, [4, 5, 6, 7]) }), 'black', 'hard')).toEqual({
      losing: false,
      commanding: true,
    })
  })

  it('keeps a forced block far less critical than an open position', () => {
    const forced = decideAiMove(
      withStones({ white: row(7, [4, 5, 6, 7]), black: [{ x: 3, y: 7 }] }),
      'black',
      'hard',
    )
    const open = decideAiMove(withStones({ black: [{ x: 7, y: 7 }], white: [{ x: 8, y: 8 }] }), 'white', 'hard')
    expect(open.criticality).toBeGreaterThan(forced.criticality)
  })
})
