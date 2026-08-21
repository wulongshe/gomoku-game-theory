import { describe, expect, it } from 'vitest'
import { BOARD_SIZE, createGame, isLegalChoice } from './game'

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
    expect(isLegalChoice(game, { x: 7, y: 7 })).toBe(true)
    expect(isLegalChoice(game, { x: -1, y: 0 })).toBe(false)
    expect(isLegalChoice(game, { x: 0, y: BOARD_SIZE })).toBe(false)
  })
})
