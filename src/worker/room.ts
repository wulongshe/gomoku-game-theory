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
  replaced?: boolean
}

type Players = Partial<Record<Seat, string>>

export class Room extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 })
    }
    const token = new URL(request.url).searchParams.get('token')
    if (!token) {
      return new Response('Missing token', { status: 400 })
    }

    const players = (await this.ctx.storage.get<Players>('players')) ?? {}
    let seat: Seat
    if (players.p1 === token) seat = 'p1'
    else if (players.p2 === token) seat = 'p2'
    else if (!players.p1) seat = 'p1'
    else if (!players.p2) seat = 'p2'
    else return new Response('Room is full', { status: 409 })

    if (players[seat] !== token) {
      players[seat] = token
      await this.ctx.storage.put('players', players)
    }

    for (const other of this.ctx.getWebSockets()) {
      const attachment = other.deserializeAttachment() as Attachment
      if (attachment.seat === seat) {
        other.serializeAttachment({ ...attachment, replaced: true })
        other.close(1000, 'replaced by reconnect')
      }
    }

    const pair = new WebSocketPair()
    this.ctx.acceptWebSocket(pair[1])
    pair[1].serializeAttachment({ seat } satisfies Attachment)
    this.send(pair[1], { type: 'joined', seat })

    const game = await this.ctx.storage.get<GameState>('game')
    if (game) {
      const deadline = (await this.ctx.storage.get<number>('deadline'))!
      const choices = (await this.ctx.storage.get<Partial<FrameChoices>>('choices')) ?? {}
      this.send(pair[1], {
        type: 'start',
        state: game,
        deadline,
        submitted: { p1: 'p1' in choices, p2: 'p2' in choices },
        yourChoice: choices[seat] ?? null,
      })
      for (const other of this.ctx.getWebSockets()) {
        if (other !== pair[1]) this.send(other, { type: 'opponent_returned' })
      }
    } else if (this.ctx.getWebSockets().length === 2) {
      const fresh = createGame()
      const deadline = Date.now() + FRAME_MS
      await this.ctx.storage.put({ game: fresh, deadline })
      await this.ctx.storage.setAlarm(deadline)
      this.broadcast({
        type: 'start',
        state: fresh,
        deadline,
        submitted: { p1: false, p2: false },
        yourChoice: null,
      })
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
    if (this.ctx.getWebSockets().length === 0) {
      return this.close()
    }
    const game = await this.ctx.storage.get<GameState>('game')
    if (!game || game.phase !== 'playing') return
    const choices = (await this.ctx.storage.get<Partial<FrameChoices>>('choices')) ?? {}
    await this.settle(game, choices)
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    const attachment = ws.deserializeAttachment() as Attachment
    if (attachment.replaced) return
    const remaining = this.ctx.getWebSockets().filter((other) => other !== ws)
    for (const other of remaining) {
      this.send(other, { type: 'opponent_left' })
    }
    if (remaining.length === 0 && !(await this.ctx.storage.get('game'))) {
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
