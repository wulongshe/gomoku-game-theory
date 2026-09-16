import { decodeBoard } from '@gomoku/engine/challenge'
import type { CellState } from '@gomoku/engine/game'

// 当前一期残局：每周日 0 点手动换成本目录里另一个文件名（文件名即内容 hash，由 pnpm challenge:gen 生成）。
export const CHALLENGE_ID = 'e905186a093dd20f'

const files = import.meta.glob('./*.bin', { query: '?inline', import: 'default', eager: true }) as Record<
  string,
  string
>

export function challengeBoard(): CellState[] {
  const dataUrl = files[`./${CHALLENGE_ID}.bin`]
  if (!dataUrl) throw new Error(`challenge ${CHALLENGE_ID} not found`)
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
  return decodeBoard(Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)))
}
