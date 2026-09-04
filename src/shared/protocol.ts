import type { GameMode, GameState, Point, Seat } from '@gomoku/engine/game'

export const FRAME_OPTIONS = [30, 60, 0]
export const MODE_OPTIONS: GameMode[] = ['forbidden', 'minus']

// 房号纯数字、优先 4 位好记；同长度接连撞车（房间多）才升到 6、8 位。
export const ROOM_CODE_LENGTHS = [4, 6, 8]
export const ROOM_CODE_MAX_LENGTH = ROOM_CODE_LENGTHS[ROOM_CODE_LENGTHS.length - 1]
export const ROOM_CODE_PATTERN = /^\d{4,8}$/

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
export const PASSWORD_MIN_LENGTH = 8

// 大赛对局逐帧时限：开局快节奏，中盘逐帧放宽到 45s 封顶（前 5 帧 10s，之后每帧 +1s）。
export function tournamentFrameSeconds(frame: number): number {
  return Math.min(45, Math.max(10, 10 + frame - 5))
}

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
  | { type: 'resign' }
  | { type: 'draw_offer' }
  | { type: 'draw_response'; accept: boolean }

export type LobbyServerMessage = { type: 'matched'; code: string }

export type ServerMessage =
  | { type: 'joined'; seat: Seat; frameSeconds: number; mode: GameMode; tournament?: true; spectator?: true }
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
  | {
      type: 'frame_settled'
      state: GameState
      deadline: number | null
      now: number
      passed: Seat[]
      moves?: FrameMoves // 本帧双方落点；判负/认输等非落子终局的广播不带
    }
  | { type: 'opponent_left' }
  | { type: 'opponent_returned' }
  | { type: 'opponent_resigned'; left: boolean }
  | { type: 'draw_offered' }
  | { type: 'draw_declined' }
  | { type: 'room_closed' }
  | { type: 'rematch_requested'; frameSeconds: number; mode: GameMode }
  | { type: 'rematch_declined' }
  | { type: 'error'; message: string }

// 一帧的双方落点（null = 弃着），用于复盘重放。
export type FrameMoves = [Point | null, Point | null]

export interface Standing {
  email: string
  score: number
  played: number
  status?: PlayerStatus // 仅实时积分下发
}

export type PlayerStatus = 'idle' | 'matching' | 'readying' | 'playing' | 'cooldown'

export interface Match {
  code: string | null // 房号：观战入口（仅对当下可观战的人下发）
  a: string
  b: string
  status: 'readying' | 'playing' | 'done'
  result: 'a' | 'b' | 'draw' | 'void' | null
}

export interface TournamentInfo {
  state: 'idle' | 'active'
  now: number
  startsAt: number
  playerCount: number
  registered: boolean // 已报名下一场
  participating: boolean // 当前正在进行的这场的参赛者
  myGame: { code: string } | null
  matchCloseAt: number | null // 竞技场停止配新对局的时点；已开局的照常打完计分
  my: { status: PlayerStatus; cooldownUntil: number | null } | null
  standings: Standing[]
  me: number | null // 我在 standings 中的下标（脱敏前定位）
  games: Match[] // 全部对局，新的在前（仅参赛者/赛后可见）
}

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
  if (msg.type === 'resign') return { type: 'resign' }
  if (msg.type === 'draw_offer') return { type: 'draw_offer' }
  if (msg.type === 'draw_response') {
    return typeof msg.accept === 'boolean' ? { type: 'draw_response', accept: msg.accept } : null
  }
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
