import { BOARD_SIZE, winningPoints, type CellState, type GameState, type Seat } from './game'

export type ChallengeVerdict = 'playing' | 'success' | 'fail'

// 攻守易形：开局对方有一个成五点。对方先做出两个成五点判负、挑战者先做出两个判胜；同帧同时达成按对方优先。
export function challengeVerdict(state: GameState, challenger: Seat = 'black'): ChallengeVerdict {
  if (state.phase === `${challenger}_won`) return 'success'
  if (state.phase !== 'playing') return 'fail'
  const opponent: Seat = challenger === 'black' ? 'white' : 'black'
  if (winningPoints(state, opponent).length >= 2) return 'fail'
  if (winningPoints(state, challenger).length >= 2) return 'success'
  return 'playing'
}

// 残局固定禁点模式，格子只有空/黑/白/禁点四态，每格 2 bit 顺序打包：225 格 → 57 字节。
export const BOARD_CODE_BYTES = Math.ceil((BOARD_SIZE * BOARD_SIZE * 2) / 8)
const CODES: CellState[] = ['empty', 'black', 'white', 'forbidden']

export function encodeBoard(board: CellState[]): Uint8Array {
  if (board.length !== BOARD_SIZE * BOARD_SIZE) throw new Error('board size mismatch')
  const bytes = new Uint8Array(BOARD_CODE_BYTES)
  board.forEach((cell, i) => {
    const code = CODES.indexOf(cell)
    if (code < 0) throw new Error(`cell ${cell} is not encodable`)
    bytes[i >> 2] |= code << ((3 - (i & 3)) * 2)
  })
  return bytes
}

export function decodeBoard(bytes: Uint8Array): CellState[] {
  if (bytes.length !== BOARD_CODE_BYTES) throw new Error('board code size mismatch')
  return Array.from(
    { length: BOARD_SIZE * BOARD_SIZE },
    (_, i) => CODES[(bytes[i >> 2] >> ((3 - (i & 3)) * 2)) & 3],
  )
}

// 残局起手的可玩局面：帧号越过开局限制区，并与已走回合数大致对应（黑每帧落子或撞成禁点）。
export function challengeGame(board: CellState[]): GameState {
  const played = board.filter((cell) => cell === 'black' || cell === 'forbidden').length
  return {
    board: [...board],
    phase: 'playing',
    frame: Math.max(2, played + 1),
    mode: 'forbidden',
    cleared: [],
    lastMoves: [],
    winningLines: [],
  }
}
