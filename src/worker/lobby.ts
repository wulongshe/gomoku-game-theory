import { DurableObject } from 'cloudflare:workers'
import { FRAME_SECONDS } from '@/engine/game'
import type { LobbyServerMessage } from '@/shared/protocol'
import { newRoomCode } from './roomCode'

interface Attachment {
  frame: number
}

export class Lobby extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 })
    }
    const frame = Number(new URL(request.url).searchParams.get('frame') ?? FRAME_SECONDS)
    const pair = new WebSocketPair()
    this.ctx.acceptWebSocket(pair[1])
    pair[1].serializeAttachment({ frame } satisfies Attachment)

    const waiting = this.ctx
      .getWebSockets()
      .find((ws) => ws !== pair[1] && (ws.deserializeAttachment() as Attachment).frame === frame)
    if (waiting) {
      const code = newRoomCode()
      await this.env.ROOM.get(this.env.ROOM.idFromName(code)).fetch(
        `https://room/create?frame=${frame}`,
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
