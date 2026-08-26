import { DurableObject } from 'cloudflare:workers'
import type { GameMode } from '@/engine/game'
import { FRAME_OPTIONS, MODE_OPTIONS, type LobbyServerMessage } from '@/shared/protocol'
import { newRoomCode } from './roomCode'

export interface MatchOptions {
  frames: number[]
  modes: GameMode[]
}

export function parseMatchOptions(params: URLSearchParams): MatchOptions | null {
  const list = (name: string) => [...new Set((params.get(name) ?? '').split(',').filter(Boolean))]
  const frames = list('frames').map(Number)
  const modes = list('modes') as GameMode[]
  if (!frames.length || frames.some((f) => !FRAME_OPTIONS.includes(f))) return null
  if (!modes.length || modes.some((m) => !MODE_OPTIONS.includes(m))) return null
  return { frames, modes }
}

function sample<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)]
}

const UNTIMED_RACE_WEIGHT = 2

export function pickSettings(
  frames: number[],
  modes: GameMode[],
  rng: () => number = Math.random,
): { frame: number; mode: GameMode } {
  const combos = frames.flatMap((frame) => modes.map((mode) => ({ frame, mode })))
  const weight = (c: { frame: number; mode: GameMode }) =>
    c.frame === 0 && c.mode === 'race' ? UNTIMED_RACE_WEIGHT : 1
  let roll = rng() * combos.reduce((sum, c) => sum + weight(c), 0)
  for (const combo of combos) {
    roll -= weight(combo)
    if (roll < 0) return combo
  }
  return combos[combos.length - 1]
}

export class Lobby extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 })
    }
    const options = parseMatchOptions(new URL(request.url).searchParams)
    if (!options) {
      return new Response('Invalid options', { status: 400 })
    }
    const pair = new WebSocketPair()
    this.ctx.acceptWebSocket(pair[1])
    pair[1].serializeAttachment(options)

    const candidates = this.ctx.getWebSockets().flatMap((ws) => {
      if (ws === pair[1]) return []
      const other = ws.deserializeAttachment() as MatchOptions
      const frames = other.frames.filter((f) => options.frames.includes(f))
      const modes = other.modes.filter((m) => options.modes.includes(m))
      return frames.length && modes.length ? [{ ws, frames, modes }] : []
    })
    if (candidates.length) {
      const overlap = Math.min(...candidates.map((c) => c.frames.length * c.modes.length))
      const picked = sample(candidates.filter((c) => c.frames.length * c.modes.length === overlap))
      const { frame, mode } = pickSettings(picked.frames, picked.modes)
      const code = newRoomCode()
      await this.env.ROOM.get(this.env.ROOM.idFromName(code)).fetch(
        `https://room/create?frame=${frame}&mode=${mode}`,
        { method: 'POST' },
      )
      const matched = JSON.stringify({ type: 'matched', code } satisfies LobbyServerMessage)
      for (const ws of [picked.ws, pair[1]]) {
        try {
          ws.send(matched)
          ws.close(1000, 'matched')
        } catch {}
      }
    }

    return new Response(null, { status: 101, webSocket: pair[0] })
  }
}
