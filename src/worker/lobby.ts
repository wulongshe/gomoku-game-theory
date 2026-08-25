import { DurableObject } from 'cloudflare:workers'
import { FRAME_SECONDS, type GameMode } from '@/engine/game'
import type { LobbyServerMessage } from '@/shared/protocol'
import { newRoomCode } from './roomCode'

interface Attachment {
  frame: number
  mode: GameMode
}

export class Lobby extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 })
    }
    const params = new URL(request.url).searchParams
    const frame = Number(params.get('frame') ?? FRAME_SECONDS)
    const mode = (params.get('mode') ?? 'forbidden') as GameMode
    const pair = new WebSocketPair()
    this.ctx.acceptWebSocket(pair[1])
    pair[1].serializeAttachment({ frame, mode } satisfies Attachment)

    const waiting = this.ctx.getWebSockets().find((ws) => {
      if (ws === pair[1]) return false
      const other = ws.deserializeAttachment() as Attachment
      return other.frame === frame && other.mode === mode
    })
    if (waiting) {
      const code = newRoomCode()
      await this.env.ROOM.get(this.env.ROOM.idFromName(code)).fetch(
        `https://room/create?frame=${frame}&mode=${mode}`,
        { method: 'POST' },
      )
      const matched = JSON.stringify({ type: 'matched', code } satisfies LobbyServerMessage)
      for (const ws of [waiting, pair[1]]) {
        try {
          ws.send(matched)
          ws.close(1000, 'matched')
        } catch {}
      }
    }

    return new Response(null, { status: 101, webSocket: pair[0] })
  }
}
