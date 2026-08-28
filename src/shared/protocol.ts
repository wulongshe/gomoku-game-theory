import type { GameMode, GameState, Point, Seat } from '@/engine/game'

export const FRAME_OPTIONS = [30, 60, 120, 0]
// 共子（shared）入口暂时下线
export const MODE_OPTIONS: GameMode[] = ['forbidden', 'half', 'minus', 'race']

export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
export const ROOM_CODE_LENGTH = 6
export const ROOM_CODE_PATTERN = /^[A-Z0-9]{6}$/

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
export const PASSWORD_MIN_LENGTH = 8

export function maskEmail(email: string): string {
  const [local, domain] = email.split('@')
  const visible = local.length > 2 ? local.slice(0, 2) : local.slice(0, 1)
  return `${visible}***@${domain}`
}

export type ClientMessage =
  | { type: 'submit'; frame: number; point: Point | null; final: boolean }
  | { type: 'ready' }
  | { type: 'rematch'; frameSeconds: number; mode: GameMode }
  | { type: 'rematch_decline' }
  | { type: 'leave' }
  | { type: 'refresh_players' }

export type LobbyServerMessage = { type: 'matched'; code: string }

export type ServerMessage =
  | { type: 'joined'; seat: Seat; frameSeconds: number; mode: GameMode }
  | { type: 'lobby'; present: Record<Seat, boolean>; ready: Record<Seat, boolean> }
  | { type: 'players'; accounts: Record<Seat, string | null> }
  | {
      type: 'start'
      state: GameState
      deadline: number | null
      now: number
      elapsed: number
      frameSeconds: number
      submitted: Record<Seat, boolean>
      yourChoice: Point | null
    }
  | { type: 'opponent_submitted'; submitted: boolean }
  | { type: 'frame_settled'; state: GameState; deadline: number | null; now: number }
  | { type: 'opponent_left' }
  | { type: 'opponent_returned' }
  | { type: 'room_closed' }
  | { type: 'rematch_requested'; frameSeconds: number; mode: GameMode }
  | { type: 'rematch_declined' }
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
  if (msg.type === 'ready') return { type: 'ready' }
  if (msg.type === 'rematch') {
    if (!FRAME_OPTIONS.includes(msg.frameSeconds as number)) return null
    if (!MODE_OPTIONS.includes(msg.mode as GameMode)) return null
    return { type: 'rematch', frameSeconds: msg.frameSeconds as number, mode: msg.mode as GameMode }
  }
  if (msg.type === 'rematch_decline') return { type: 'rematch_decline' }
  if (msg.type === 'leave') return { type: 'leave' }
  if (msg.type === 'refresh_players') return { type: 'refresh_players' }
  if (msg.type !== 'submit' || !Number.isInteger(msg.frame) || typeof msg.final !== 'boolean') {
    return null
  }
  const frame = msg.frame as number
  const final = msg.final
  if (msg.point === null) return { type: 'submit', frame, point: null, final }
  if (typeof msg.point !== 'object' || msg.point === null) return null
  const point = msg.point as Record<string, unknown>
  if (!Number.isInteger(point.x) || !Number.isInteger(point.y)) return null
  return { type: 'submit', frame, point: { x: point.x as number, y: point.y as number }, final }
}
