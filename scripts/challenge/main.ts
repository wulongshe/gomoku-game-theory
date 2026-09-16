// 从 AI 自对弈（禁点模式）里挑「攻守易形」残局：对方恰有一个成五点、本方没有，
// 且守方随后 MAX_LEN 帧内先做出两个成五点。挑战方统一转为黑，编码后按内容 hash 存入 src/client/challenges。
// 用法：pnpm challenge:gen（COUNT=5 LEVEL=normal MAX_LEN=8）
import { createHash } from 'node:crypto'
import { existsSync, writeFileSync } from 'node:fs'
import {
  createGame,
  settleFrame,
  winningPoints,
  type CellState,
  type GameState,
  type Seat,
} from '../../packages/engine/src/game'
import { challengeGame, challengeVerdict, encodeBoard } from '../../packages/engine/src/challenge'
import { decideAiMove, type Difficulty } from '../../packages/engine/src/ai'

const COUNT = Number(process.env.COUNT ?? 5)
const LEVEL = (process.env.LEVEL ?? 'normal') as Difficulty
const MAX_LEN = Number(process.env.MAX_LEN ?? 8)
const MAX_FRAMES = 200
const OUT_DIR = new URL('../../src/client/challenges/', import.meta.url)

const other = (seat: Seat): Seat => (seat === 'black' ? 'white' : 'black')

function normalizeToBlack(board: CellState[], challenger: Seat): CellState[] {
  if (challenger === 'black') return [...board]
  return board.map((cell) => (cell === 'black' ? 'white' : cell === 'white' ? 'black' : cell))
}

function isCandidate(state: GameState, seat: Seat): boolean {
  return winningPoints(state, other(seat)).length === 1 && winningPoints(state, seat).length === 0
}

interface Found {
  board: CellState[]
  length: number
}

function playOne(): Found[] {
  const found: Found[] = []
  let state = createGame('forbidden')
  const open: Partial<Record<Seat, { board: CellState[]; frame: number }>> = {}
  while (state.phase === 'playing' && state.frame < MAX_FRAMES) {
    for (const seat of ['black', 'white'] as const) {
      if (!open[seat] && isCandidate(state, seat)) {
        open[seat] = { board: normalizeToBlack(state.board, seat), frame: state.frame }
      }
    }
    state = settleFrame(state, {
      black: decideAiMove(state, 'black', LEVEL).point,
      white: decideAiMove(state, 'white', LEVEL).point,
    })
    for (const seat of ['black', 'white'] as const) {
      const episode = open[seat]
      if (!episode) continue
      const verdict = challengeVerdict(state, seat)
      if (verdict === 'playing') continue
      const length = state.frame - episode.frame
      if (verdict === 'success' && length <= MAX_LEN) found.push({ board: episode.board, length })
      delete open[seat]
    }
  }
  return found
}

let written = 0
let games = 0
while (written < COUNT) {
  games++
  for (const { board, length } of playOne()) {
    const bytes = encodeBoard(board)
    const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 16)
    const file = new URL(`${hash}.bin`, OUT_DIR)
    if (existsSync(file)) continue
    const start = challengeGame(board)
    const forbidden = board.filter((c) => c === 'forbidden').length
    writeFileSync(file, bytes)
    written++
    console.log(
      `${hash}  第${start.frame}回合起  守方${length}帧成叉  对方成五点 ${winningPoints(start, 'white').length}  黑${board.filter((c) => c === 'black').length}子/白${board.filter((c) => c === 'white').length}子/禁点${forbidden}`,
    )
    if (written >= COUNT) break
  }
}
console.log(`\n${games} 局自对弈，写入 ${written} 个残局 → src/client/challenges/`)
