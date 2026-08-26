import { DurableObject } from 'cloudflare:workers'
import {
  createGame,
  FRAME_SECONDS,
  isLegalChoice,
  settleFrame,
  type GameMode,
  type GameState,
  type Point,
  type Seat,
} from '@/engine/game'
import { parseClientMessage, type ServerMessage } from '@/shared/protocol'

const IDLE_TTL_MS = 10 * 60 * 1000

interface Attachment {
  seat: Seat
  replaced?: boolean
}

type Players = Partial<Record<Seat, string>>

type Choices = Partial<Record<Seat, { point: Point | null; final: boolean }>>

type SeatFlags = Partial<Record<Seat, boolean>>

export class Room extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    if (request.method === 'POST') {
      const frameSeconds = Number(url.searchParams.get('frame') ?? FRAME_SECONDS)
      const mode = (url.searchParams.get('mode') ?? 'forbidden') as GameMode
      await this.ctx.storage.put({ created: true, frameSeconds, mode })
      await this.ctx.storage.setAlarm(Date.now() + IDLE_TTL_MS)
      return new Response(null, { status: 204 })
    }
    const created = (await this.ctx.storage.get<boolean>('created')) ?? false
    if (!url.pathname.endsWith('/ws')) {
      const players = (await this.ctx.storage.get<Players>('players')) ?? {}
      const token = url.searchParams.get('token')
      const hasSeat =
        !players.black || !players.white || token === players.black || token === players.white
      return Response.json({ exists: created, full: !hasSeat })
    }
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 })
    }
    if (!created) {
      return new Response('Room not found', { status: 404 })
    }
    const token = url.searchParams.get('token')
    if (!token) {
      return new Response('Missing token', { status: 400 })
    }

    const players = (await this.ctx.storage.get<Players>('players')) ?? {}
    let seat: Seat
    if (players.black === token) seat = 'black'
    else if (players.white === token) seat = 'white'
    else if (!players.black) seat = 'black'
    else if (!players.white) seat = 'white'
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
    this.send(pair[1], {
      type: 'joined',
      seat,
      frameSeconds: await this.frameSeconds(),
      mode: await this.mode(),
    })

    const game = await this.ctx.storage.get<GameState>('game')
    if (game) {
      const deadline = (await this.ctx.storage.get<number>('deadline'))!
      const choices = (await this.ctx.storage.get<Choices>('choices')) ?? {}
      this.send(pair[1], {
        type: 'start',
        state: game,
        deadline: game.phase === 'playing' ? deadline : null,
        now: Date.now(),
        frameSeconds: await this.frameSeconds(),
        submitted: { black: !!choices.black?.final, white: !!choices.white?.final },
        yourChoice: choices[seat]?.point ?? null,
      })
      for (const other of this.ctx.getWebSockets()) {
        if (other !== pair[1]) this.send(other, { type: 'opponent_returned' })
      }
    } else {
      const ready = (await this.ctx.storage.get<SeatFlags>('ready')) ?? {}
      if (ready.black && ready.white && this.ctx.getWebSockets().length === 2) {
        await this.startGame()
      } else {
        await this.broadcastLobby()
      }
    }

    return new Response(null, { status: 101, webSocket: pair[0] })
  }

  private async broadcastLobby(exclude?: WebSocket): Promise<void> {
    const sockets = this.ctx.getWebSockets().filter((ws) => ws !== exclude)
    const present = { black: false, white: false }
    for (const ws of sockets) {
      const attachment = ws.deserializeAttachment() as Attachment
      if (!attachment.replaced) present[attachment.seat] = true
    }
    const ready = (await this.ctx.storage.get<SeatFlags>('ready')) ?? {}
    const message: ServerMessage = {
      type: 'lobby',
      present,
      ready: { black: !!ready.black, white: !!ready.white },
    }
    for (const ws of sockets) {
      this.send(ws, message)
    }
  }

  private async frameSeconds(): Promise<number> {
    return (await this.ctx.storage.get<number>('frameSeconds')) ?? FRAME_SECONDS
  }

  private async mode(): Promise<GameMode> {
    return (await this.ctx.storage.get<GameMode>('mode')) ?? 'forbidden'
  }

  private async startGame(): Promise<void> {
    const game = createGame(await this.mode())
    const frameSeconds = await this.frameSeconds()
    const deadline = Date.now() + frameSeconds * 1000
    await this.ctx.storage.delete(['choices', 'rematch', 'ready'])
    await this.ctx.storage.put({ game, deadline })
    await this.ctx.storage.setAlarm(deadline)
    this.broadcast({
      type: 'start',
      state: game,
      deadline,
      now: Date.now(),
      frameSeconds,
      submitted: { black: false, white: false },
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
    if (msg.type === 'ready') {
      if (game) return
      const ready = (await this.ctx.storage.get<SeatFlags>('ready')) ?? {}
      if (!ready[seat]) {
        ready[seat] = true
        await this.ctx.storage.put('ready', ready)
      }
      if (ready.black && ready.white && this.ctx.getWebSockets().length === 2) {
        return this.startGame()
      }
      return this.broadcastLobby()
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
    if (msg.point && !isLegalChoice(game, msg.point)) {
      return this.send(ws, { type: 'error', message: 'illegal point' })
    }

    const wasFinal = !!choices[seat]?.final
    choices[seat] = { point: msg.point, final: msg.final }
    await this.ctx.storage.put('choices', choices)
    if (msg.final !== wasFinal) {
      for (const other of this.ctx.getWebSockets()) {
        if (other !== ws) this.send(other, { type: 'opponent_submitted', submitted: msg.final })
      }
    }
    if (msg.final && choices.black?.final && choices.white?.final) {
      await this.settle(game, choices)
    }
  }

  private async handleLeave(seat: Seat, game: GameState | undefined): Promise<void> {
    if (game && game.phase === 'playing') {
      const resigned: GameState = {
        ...game,
        phase: seat === 'black' ? 'white_won' : 'black_won',
        cleared: [],
      }
      this.broadcast({ type: 'frame_settled', state: resigned, deadline: null, now: Date.now() })
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
    const rematch = (await this.ctx.storage.get<SeatFlags>('rematch')) ?? {}
    if (!rematch[seat]) {
      rematch[seat] = true
      await this.ctx.storage.put('rematch', rematch)
      for (const other of this.ctx.getWebSockets()) {
        if (other !== ws) this.send(other, { type: 'rematch_requested' })
      }
    }
    if (rematch.black && rematch.white) {
      await this.startGame()
    }
  }

  async alarm(): Promise<void> {
    if (this.ctx.getWebSockets().length === 0) {
      return this.close()
    }
    const game = await this.ctx.storage.get<GameState>('game')
    if (!game || game.phase !== 'playing') {
      return this.ctx.storage.setAlarm(Date.now() + IDLE_TTL_MS)
    }
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
    const game = await this.ctx.storage.get<GameState>('game')
    if (remaining.length === 0) {
      if (game && game.phase !== 'playing') await this.close()
      else if (!game) await this.ctx.storage.setAlarm(Date.now() + IDLE_TTL_MS)
    } else if (!game) {
      await this.broadcastLobby(ws)
    }
  }

  private async settle(game: GameState, choices: Choices): Promise<void> {
    const next = settleFrame(game, {
      black: choices.black?.point ?? null,
      white: choices.white?.point ?? null,
    })
    if (next.phase === 'playing') {
      const deadline = Date.now() + (await this.frameSeconds()) * 1000
      await this.ctx.storage.delete('choices')
      await this.ctx.storage.put({ game: next, deadline })
      await this.ctx.storage.setAlarm(deadline)
      this.broadcast({ type: 'frame_settled', state: next, deadline, now: Date.now() })
    } else {
      await this.ctx.storage.delete('choices')
      await this.ctx.storage.setAlarm(Date.now() + IDLE_TTL_MS)
      await this.ctx.storage.put('game', next)
      this.broadcast({ type: 'frame_settled', state: next, deadline: null, now: Date.now() })
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
