import { DurableObject } from 'cloudflare:workers'
import {
  createGame,
  FRAME_SECONDS,
  isLegalChoice,
  settleFrame,
  type GameState,
  type Point,
  type Seat,
} from '@/engine/game'
import { parseClientMessage, type ServerMessage } from '@/shared/protocol'

const FRAME_MS = FRAME_SECONDS * 1000

interface Attachment {
  seat: Seat
  replaced?: boolean
}

type Players = Partial<Record<Seat, string>>

type Choices = Partial<Record<Seat, { point: Point | null; final: boolean }>>

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
      const choices = (await this.ctx.storage.get<Choices>('choices')) ?? {}
      this.send(pair[1], {
        type: 'start',
        state: game,
        deadline: game.phase === 'playing' ? deadline : null,
        submitted: { p1: !!choices.p1?.final, p2: !!choices.p2?.final },
        yourChoice: choices[seat]?.point ?? null,
      })
      for (const other of this.ctx.getWebSockets()) {
        if (other !== pair[1]) this.send(other, { type: 'opponent_returned' })
      }
    } else if (this.ctx.getWebSockets().length === 2) {
      await this.startGame()
    }

    return new Response(null, { status: 101, webSocket: pair[0] })
  }

  private async startGame(): Promise<void> {
    const game = createGame()
    const deadline = Date.now() + FRAME_MS
    await this.ctx.storage.delete(['choices', 'rematch'])
    await this.ctx.storage.put({ game, deadline })
    await this.ctx.storage.setAlarm(deadline)
    this.broadcast({
      type: 'start',
      state: game,
      deadline,
      submitted: { p1: false, p2: false },
      yourChoice: null,
    })
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== 'string') return
    const msg = parseClientMessage(message)
    if (!msg) {
      return this.send(ws, { type: 'error', message: 'malformed message' })
    }
    const { seat } = ws.deserializeAttachment() as Attachment
    const game = await this.ctx.storage.get<GameState>('game')
    if (msg.type === 'leave') {
      return this.handleLeave(seat, game)
    }
    if (msg.type === 'rematch') {
      return this.handleRematch(ws, seat, game)
    }
    if (msg.type === 'rematch_decline') {
      if (game && game.phase !== 'playing') {
        await this.ctx.storage.delete('rematch')
        for (const other of this.ctx.getWebSockets()) {
          if (other !== ws) this.send(other, { type: 'rematch_declined' })
        }
      }
      return
    }
    if (!game || game.phase !== 'playing') {
      return this.send(ws, { type: 'error', message: 'game not in progress' })
    }
    if (msg.frame !== game.frame) {
      return this.send(ws, { type: 'error', message: 'stale frame' })
    }
    const choices = (await this.ctx.storage.get<Choices>('choices')) ?? {}
    if (choices[seat]?.final) {
      return this.send(ws, { type: 'error', message: 'already submitted' })
    }
    if (msg.point && !isLegalChoice(game, msg.point)) {
      return this.send(ws, { type: 'error', message: 'illegal point' })
    }

    choices[seat] = { point: msg.point, final: msg.final }
    await this.ctx.storage.put('choices', choices)
    if (msg.final) {
      for (const other of this.ctx.getWebSockets()) {
        if (other !== ws) this.send(other, { type: 'opponent_submitted' })
      }
      if (choices.p1?.final && choices.p2?.final) {
        await this.settle(game, choices)
      }
    }
  }

  private async handleLeave(seat: Seat, game: GameState | undefined): Promise<void> {
    if (game && game.phase === 'playing') {
      const resigned: GameState = { ...game, phase: seat === 'p1' ? 'p2_won' : 'p1_won' }
      this.broadcast({ type: 'frame_settled', state: resigned, deadline: null })
    }
    for (const socket of this.ctx.getWebSockets()) {
      socket.close(1000, 'room closed')
    }
    await this.close()
  }

  private async handleRematch(ws: WebSocket, seat: Seat, game: GameState | undefined): Promise<void> {
    if (!game || game.phase === 'playing') {
      return this.send(ws, { type: 'error', message: 'game not finished' })
    }
    const rematch = (await this.ctx.storage.get<Partial<Record<Seat, boolean>>>('rematch')) ?? {}
    if (!rematch[seat]) {
      rematch[seat] = true
      await this.ctx.storage.put('rematch', rematch)
      for (const other of this.ctx.getWebSockets()) {
        if (other !== ws) this.send(other, { type: 'rematch_requested' })
      }
    }
    if (rematch.p1 && rematch.p2) {
      await this.startGame()
    }
  }

  async alarm(): Promise<void> {
    if (this.ctx.getWebSockets().length === 0) {
      return this.close()
    }
    const game = await this.ctx.storage.get<GameState>('game')
    if (!game || game.phase !== 'playing') return
    const choices = (await this.ctx.storage.get<Choices>('choices')) ?? {}
    await this.settle(game, choices)
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    const attachment = ws.deserializeAttachment() as Attachment
    if (attachment.replaced) return
    const remaining = this.ctx.getWebSockets().filter((other) => other !== ws)
    for (const other of remaining) {
      this.send(other, { type: 'opponent_left' })
    }
    if (remaining.length === 0) {
      const game = await this.ctx.storage.get<GameState>('game')
      if (!game || game.phase !== 'playing') await this.close()
    }
  }

  private async settle(game: GameState, choices: Choices): Promise<void> {
    const next = settleFrame(game, {
      p1: choices.p1?.point ?? null,
      p2: choices.p2?.point ?? null,
    })
    if (next.phase === 'playing') {
      const deadline = Date.now() + FRAME_MS
      await this.ctx.storage.delete('choices')
      await this.ctx.storage.put({ game: next, deadline })
      await this.ctx.storage.setAlarm(deadline)
      this.broadcast({ type: 'frame_settled', state: next, deadline })
    } else {
      await this.ctx.storage.delete('choices')
      await this.ctx.storage.deleteAlarm()
      await this.ctx.storage.put('game', next)
      this.broadcast({ type: 'frame_settled', state: next, deadline: null })
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
