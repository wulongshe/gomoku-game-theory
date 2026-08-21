import type { GameState, Point, Seat } from '../engine/game'

export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
export const ROOM_CODE_LENGTH = 6
export const ROOM_CODE_PATTERN = /^[A-Z0-9]{6}$/

export type ClientMessage = { type: 'submit'; frame: number; point: Point | null }

export type ServerMessage =
  | { type: 'joined'; seat: Seat }
  | { type: 'start'; state: GameState; deadline: number }
  | { type: 'opponent_submitted' }
  | { type: 'frame_settled'; state: GameState; deadline: number | null }
  | { type: 'opponent_left' }
  | { type: 'error'; message: string }
