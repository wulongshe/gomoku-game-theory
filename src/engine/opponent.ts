import { winningPoints } from './eval'
import type { GameState, Point, Seat } from './game'

// 对手模型：只跟踪「人类对 AI 立即取胜点的封堵率」——同时落子下，这正是能否兑现四的唯一关键变量。
// 先验取高值（假定对手会堵，等同纯纳什的保守打法），再由实战观测把它拉向对手的真实倾向。
export const DEFAULT_BLOCK_RATE = 0.85
const EMA_ALPHA = 0.35

// 用「上一帧 AI 有立即胜点时，人类是否落在其上」更新封堵率；无胜点的帧不含防守信息，不更新。
export function observeBlock(
  blockRate: number,
  prevState: GameState,
  humanMove: Point,
  aiSeat: Seat,
): number {
  const wins = winningPoints(prevState, aiSeat)
  if (wins.length === 0) return blockRate
  const blocked = wins.some((p) => p.x === humanMove.x && p.y === humanMove.y)
  return blockRate + EMA_ALPHA * ((blocked ? 1 : 0) - blockRate)
}
