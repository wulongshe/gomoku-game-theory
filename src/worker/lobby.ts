import { DurableObject } from 'cloudflare:workers'
import type { LobbyServerMessage } from '@/shared/protocol'
import { newRoomCode } from './roomCode'

export class Lobby extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 })
    }
    const pair = new WebSocketPair()
    this.ctx.acceptWebSocket(pair[1])

    const waiting = this.ctx.getWebSockets().find((ws) => ws !== pair[1])
    if (waiting) {
      const code = newRoomCode()
      await this.env.ROOM.get(this.env.ROOM.idFromName(code)).fetch('https://room/create', {
        method: 'POST',
      })
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
