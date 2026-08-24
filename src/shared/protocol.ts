import type { GameState, Point, Seat } from '@/engine/game'

export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
export const ROOM_CODE_LENGTH = 6
export const ROOM_CODE_PATTERN = /^[A-Z0-9]{6}$/

export type ClientMessage = { type: 'submit'; frame: number; point: Point | null }

export type ServerMessage =
  | { type: 'joined'; seat: Seat }
  | {
      type: 'start'
      state: GameState
      deadline: number
      submitted: Record<Seat, boolean>
      yourChoice: Point | null
    }
  | { type: 'opponent_submitted' }
  | { type: 'frame_settled'; state: GameState; deadline: number | null }
  | { type: 'opponent_left' }
  | { type: 'opponent_returned' }
  | { type: 'error'; message: string }

export function parseClientMessage(raw: string): ClientMessage | null {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof data !== 'object' || data === null) return null
  const msg = data as Record<string, unknown>
  if (msg.type !== 'submit' || !Number.isInteger(msg.frame)) return null
  const frame = msg.frame as number
  if (msg.point === null) return { type: 'submit', frame, point: null }
  if (typeof msg.point !== 'object' || msg.point === null) return null
  const point = msg.point as Record<string, unknown>
  if (!Number.isInteger(point.x) || !Number.isInteger(point.y)) return null
  return { type: 'submit', frame, point: { x: point.x as number, y: point.y as number } }
}
