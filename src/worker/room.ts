import { DurableObject } from 'cloudflare:workers'
import {
  createGame,
  FRAME_SECONDS,
  isLegalChoice,
  settleFrame,
  type FrameChoices,
  type GameState,
  type Seat,
} from '@/engine/game'
import { parseClientMessage, type ServerMessage } from '@/shared/protocol'

const FRAME_MS = FRAME_SECONDS * 1000

interface Attachment {
  seat: Seat
}

export class Room extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 })
    }
    const sockets = this.ctx.getWebSockets()
    if (sockets.length >= 2) {
      return new Response('Room is full', { status: 409 })
    }
    if (await this.ctx.storage.get('game')) {
      return new Response('Game already started', { status: 409 })
    }

    const taken = sockets.map((ws) => (ws.deserializeAttachment() as Attachment).seat)
    const seat: Seat = taken.includes('p1') ? 'p2' : 'p1'
    const pair = new WebSocketPair()
    this.ctx.acceptWebSocket(pair[1])
    pair[1].serializeAttachment({ seat } satisfies Attachment)
    this.send(pair[1], { type: 'joined', seat })

    if (this.ctx.getWebSockets().length === 2) {
      const game = createGame()
      const deadline = Date.now() + FRAME_MS
      await this.ctx.storage.put({ game, deadline })
      await this.ctx.storage.setAlarm(deadline)
      this.broadcast({ type: 'start', state: game, deadline })
    }

    return new Response(null, { status: 101, webSocket: pair[0] })
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== 'string') return
    const msg = parseClientMessage(message)
    if (!msg) {
      return this.send(ws, { type: 'error', message: 'malformed message' })
    }
    const game = await this.ctx.storage.get<GameState>('game')
    if (!game || game.phase !== 'playing') {
      return this.send(ws, { type: 'error', message: 'game not in progress' })
    }
    if (msg.frame !== game.frame) {
      return this.send(ws, { type: 'error', message: 'stale frame' })
    }
    const { seat } = ws.deserializeAttachment() as Attachment
    const choices = (await this.ctx.storage.get<Partial<FrameChoices>>('choices')) ?? {}
    if (seat in choices) {
      return this.send(ws, { type: 'error', message: 'already submitted' })
    }
    if (msg.point && !isLegalChoice(game, msg.point)) {
      return this.send(ws, { type: 'error', message: 'illegal point' })
    }

    choices[seat] = msg.point
    await this.ctx.storage.put('choices', choices)
    for (const other of this.ctx.getWebSockets()) {
      if (other !== ws) this.send(other, { type: 'opponent_submitted' })
    }
    if ('p1' in choices && 'p2' in choices) {
      await this.settle(game, choices)
    }
  }

  async alarm(): Promise<void> {
    const game = await this.ctx.storage.get<GameState>('game')
    if (!game || game.phase !== 'playing') return
    const choices = (await this.ctx.storage.get<Partial<FrameChoices>>('choices')) ?? {}
    await this.settle(game, choices)
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    const remaining = this.ctx.getWebSockets().filter((other) => other !== ws)
    for (const other of remaining) {
      this.send(other, { type: 'opponent_left' })
    }
    if (remaining.length === 0) {
      await this.close()
    }
  }

  private async settle(game: GameState, choices: Partial<FrameChoices>): Promise<void> {
    const next = settleFrame(game, { p1: choices.p1 ?? null, p2: choices.p2 ?? null })
    if (next.phase === 'playing') {
      const deadline = Date.now() + FRAME_MS
      await this.ctx.storage.delete('choices')
      await this.ctx.storage.put({ game: next, deadline })
      await this.ctx.storage.setAlarm(deadline)
      this.broadcast({ type: 'frame_settled', state: next, deadline })
    } else {
      this.broadcast({ type: 'frame_settled', state: next, deadline: null })
      for (const ws of this.ctx.getWebSockets()) {
        ws.close(1000, 'game over')
      }
      await this.close()
    }
  }

  private async close(): Promise<void> {
    await this.ctx.storage.deleteAlarm()
    await this.ctx.storage.deleteAll()
  }

  private broadcast(message: ServerMessage): void {
    for (const ws of this.ctx.getWebSockets()) {
      this.send(ws, message)
    }
  }

  private send(ws: WebSocket, message: ServerMessage): void {
    try {
      ws.send(JSON.stringify(message))
    } catch {}
  }
}
