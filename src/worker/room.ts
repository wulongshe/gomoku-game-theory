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
import { maskEmail, parseClientMessage, type ServerMessage } from '@/shared/protocol'
import type { GameOutcome } from './accounts'

const IDLE_TTL_MS = 10 * 60 * 1000

interface Attachment {
  seat: Seat
  replaced?: boolean
}

type Players = Partial<Record<Seat, string>>

type Choices = Partial<Record<Seat, { point: Point | null; final: boolean; finalAt?: number }>>

type SeatFlags = Partial<Record<Seat, boolean>>

interface RematchProposal {
  frameSeconds: number
  mode: GameMode
}

type RematchProposals = Partial<Record<Seat, RematchProposal>>

export class Room extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'))
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    if (request.method === 'POST') {
      // 房号已被占用（撞车）→ 409，让分配方换一个或升位
      if (await this.ctx.storage.get<boolean>('created')) {
        return new Response(null, { status: 409 })
      }
      const frameSeconds = Number(url.searchParams.get('frame') ?? FRAME_SECONDS)
      const mode = (url.searchParams.get('mode') ?? 'forbidden') as GameMode
      await this.ctx.storage.put({ created: true, frameSeconds, mode })
      await this.ctx.storage.setAlarm(Date.now() + IDLE_TTL_MS)
      return new Response(null, { status: 204 })
    }
    const created = (await this.ctx.storage.get<boolean>('created')) ?? false
    if (!url.pathname.endsWith('/ws')) {
      const players = (await this.ctx.storage.get<Players>('players')) ?? {}
      const accounts = (await this.ctx.storage.get<Players>('accounts')) ?? {}
      const token = url.searchParams.get('token')
      const email = await this.accountEmail(url.searchParams.get('auth'))
      const hasSeat =
        !players.black ||
        !players.white ||
        token === players.black ||
        token === players.white ||
        (email !== null && (accounts.black === email || accounts.white === email))
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
    const accounts = (await this.ctx.storage.get<Players>('accounts')) ?? {}
    const email = await this.accountEmail(url.searchParams.get('auth'))
    let seat: Seat
    if (players.black === token) seat = 'black'
    else if (players.white === token) seat = 'white'
    else if (email !== null && accounts.black === email) seat = 'black'
    else if (email !== null && accounts.white === email) seat = 'white'
    else if (!players.black) seat = 'black'
    else if (!players.white) seat = 'white'
    else return new Response('Room is full', { status: 409 })

    if (players[seat] !== token) {
      players[seat] = token
      await this.ctx.storage.put('players', players)
    }
    if (email !== null && accounts[seat] !== email) {
      accounts[seat] = email
      await this.ctx.storage.put('accounts', accounts)
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
    this.broadcast({ type: 'players', accounts: await this.displayAccounts(accounts) })

    const game = await this.ctx.storage.get<GameState>('game')
    if (game) {
      await this.ctx.storage.delete('emptySince')
      if (game.phase === 'playing' && this.ctx.getWebSockets().length === 1) {
        const stale = await this.ctx.storage.get<number>('deadline')
        if (stale !== undefined && Date.now() >= stale) {
          await this.scheduleFrame(game, await this.frameSeconds())
        }
      }
      const deadline = (await this.ctx.storage.get<number>('deadline')) ?? null
      const frameStart = await this.ctx.storage.get<number>('frameStart')
      const choices = (await this.ctx.storage.get<Choices>('choices')) ?? {}
      this.send(pair[1], {
        type: 'start',
        state: game,
        deadline: game.phase === 'playing' ? deadline : null,
        now: Date.now(),
        elapsed: game.phase === 'playing' && frameStart ? Date.now() - frameStart : 0,
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

  private async accountEmail(auth: string | null): Promise<string | null> {
    if (!auth) return null
    try {
      const profile = await this.env.ACCOUNTS.get(this.env.ACCOUNTS.idFromName('accounts')).me(auth)
      return profile?.email ?? null
    } catch {
      return null
    }
  }

  private async displayAccounts(accounts: Players): Promise<Record<Seat, string | null>> {
    const emails = [accounts.black ?? null, accounts.white ?? null]
    try {
      const [black, white] = await this.env.ACCOUNTS.get(
        this.env.ACCOUNTS.idFromName('accounts'),
      ).displayEmails(emails)
      return { black, white }
    } catch {
      const [black, white] = emails.map((email) => (email === null ? null : maskEmail(email)))
      return { black, white }
    }
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
    await this.ctx.storage.delete(['choices', 'rematch', 'ready'])
    const deadline = await this.scheduleFrame(game, frameSeconds)
    this.broadcast({
      type: 'start',
      state: game,
      deadline,
      now: Date.now(),
      elapsed: 0,
      frameSeconds,
      submitted: { black: false, white: false },
      yourChoice: null,
    })
  }

  private async scheduleFrame(game: GameState, frameSeconds: number): Promise<number | null> {
    const frameStart = Date.now()
    if (frameSeconds === 0) {
      await this.ctx.storage.delete('deadline')
      await this.ctx.storage.put({ game, frameStart })
      await this.ctx.storage.setAlarm(frameStart + IDLE_TTL_MS)
      return null
    }
    const deadline = frameStart + frameSeconds * 1000
    await this.ctx.storage.put({ game, frameStart, deadline })
    await this.ctx.storage.setAlarm(deadline)
    return deadline
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== 'string') return
    const msg = parseClientMessage(message)
    if (!msg) {
      return this.send(ws, { type: 'error', message: 'malformed message' })
    }
    const { seat } = ws.deserializeAttachment() as Attachment
    if (msg.type === 'refresh_players') {
      const accounts = (await this.ctx.storage.get<Players>('accounts')) ?? {}
      return this.broadcast({ type: 'players', accounts: await this.displayAccounts(accounts) })
    }
    const game = await this.ctx.storage.get<GameState>('game')
    if (msg.type === 'leave') {
      return this.handleLeave(ws, seat, game)
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
      return this.handleRematch(ws, seat, game, {
        frameSeconds: msg.frameSeconds,
        mode: msg.mode,
      })
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
    if (msg.type === 'resign' || msg.type === 'draw_offer' || msg.type === 'draw_response') {
      if (!game || game.phase !== 'playing') {
        return this.send(ws, { type: 'error', message: 'game not in progress' })
      }
      if (msg.type === 'resign') {
        for (const other of this.ctx.getWebSockets()) {
          if (other !== ws) this.send(other, { type: 'opponent_resigned', left: false })
        }
        return this.endGame({
          ...game,
          phase: seat === 'black' ? 'white_won' : 'black_won',
          cleared: [],
        })
      }
      if (msg.type === 'draw_offer') {
        for (const other of this.ctx.getWebSockets()) {
          if (other !== ws) this.send(other, { type: 'draw_offered' })
        }
        return
      }
      if (msg.accept) {
        return this.endGame({ ...game, phase: 'draw', cleared: [] })
      }
      for (const other of this.ctx.getWebSockets()) {
        if (other !== ws) this.send(other, { type: 'draw_declined' })
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
    choices[seat] = {
      point: msg.point,
      final: msg.final,
      ...(msg.final && { finalAt: Date.now() }),
    }
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

  private async handleLeave(
    ws: WebSocket,
    seat: Seat,
    game: GameState | undefined,
  ): Promise<void> {
    if (game && game.phase === 'playing') {
      const resigned: GameState = {
        ...game,
        phase: seat === 'black' ? 'white_won' : 'black_won',
        cleared: [],
      }
      for (const other of this.ctx.getWebSockets()) {
        if (other !== ws) this.send(other, { type: 'opponent_resigned', left: true })
      }
      this.broadcast({ type: 'frame_settled', state: resigned, deadline: null, now: Date.now(), passed: [] })
      await this.recordResult(resigned.phase)
      for (const socket of this.ctx.getWebSockets()) {
        if (socket === ws) socket.close(1000, 'room closed')
        else this.send(socket, { type: 'room_closed' })
      }
    } else {
      for (const socket of this.ctx.getWebSockets()) {
        socket.close(1000, 'room closed')
      }
    }
    await this.close()
  }

  private async handleRematch(
    ws: WebSocket,
    seat: Seat,
    game: GameState | undefined,
    proposal: RematchProposal,
  ): Promise<void> {
    if (!game || game.phase === 'playing') {
      return this.send(ws, { type: 'error', message: 'game not finished' })
    }
    const rematch = (await this.ctx.storage.get<RematchProposals>('rematch')) ?? {}
    const other = rematch[seat === 'black' ? 'white' : 'black']
    const accepted = other?.frameSeconds === proposal.frameSeconds && other.mode === proposal.mode
    if (!accepted) {
      rematch[seat] = proposal
      await this.ctx.storage.put('rematch', rematch)
      for (const socket of this.ctx.getWebSockets()) {
        if (socket !== ws) this.send(socket, { type: 'rematch_requested', ...proposal })
      }
      return
    }
    await this.ctx.storage.delete(['game', 'choices', 'rematch', 'ready', 'deadline', 'frameStart'])
    await this.ctx.storage.put({ frameSeconds: proposal.frameSeconds, mode: proposal.mode })
    await this.ctx.storage.setAlarm(Date.now() + IDLE_TTL_MS)
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = socket.deserializeAttachment() as Attachment
      this.send(socket, { type: 'joined', seat: attachment.seat, ...proposal })
    }
    await this.broadcastLobby()
  }

  async alarm(): Promise<void> {
    const game = await this.ctx.storage.get<GameState>('game')
    if (this.ctx.getWebSockets().length === 0) {
      if (game && game.phase === 'playing') {
        const emptySince = (await this.ctx.storage.get<number>('emptySince')) ?? Date.now()
        if (Date.now() - emptySince < IDLE_TTL_MS) {
          await this.ctx.storage.put('emptySince', emptySince)
          return this.ctx.storage.setAlarm(emptySince + IDLE_TTL_MS)
        }
      }
      return this.close()
    }
    if (!game || game.phase !== 'playing' || (await this.frameSeconds()) === 0) {
      return this.ctx.storage.setAlarm(Date.now() + IDLE_TTL_MS)
    }
    const choices = (await this.ctx.storage.get<Choices>('choices')) ?? {}
    await this.settle(game, choices)
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    const attachment = ws.deserializeAttachment() as Attachment
    if (attachment.replaced) return
    if (!(await this.ctx.storage.get<boolean>('created'))) return
    const remaining = this.ctx.getWebSockets().filter((other) => other !== ws)
    for (const other of remaining) {
      this.send(other, { type: 'opponent_left' })
    }
    const game = await this.ctx.storage.get<GameState>('game')
    if (!game) {
      // 离开准备页即清除该席位的准备状态，回来后需重新准备。
      const ready = (await this.ctx.storage.get<SeatFlags>('ready')) ?? {}
      if (ready[attachment.seat]) {
        delete ready[attachment.seat]
        await this.ctx.storage.put('ready', ready)
      }
    }
    if (remaining.length === 0) {
      if (game && game.phase !== 'playing') await this.close()
      else if (game) await this.ctx.storage.put('emptySince', Date.now())
      else await this.ctx.storage.setAlarm(Date.now() + IDLE_TTL_MS)
    } else if (!game) {
      await this.broadcastLobby(ws)
    }
  }

  private firstSubmitter(choices: Choices): Seat {
    const black = choices.black?.finalAt
    const white = choices.white?.finalAt
    if (black !== undefined && (white === undefined || black < white)) return 'black'
    if (white !== undefined && (black === undefined || white < black)) return 'white'
    return Math.random() < 0.5 ? 'black' : 'white'
  }

  private async settle(game: GameState, choices: Choices): Promise<void> {
    const next = settleFrame(game, {
      black: choices.black?.point ?? null,
      white: choices.white?.point ?? null,
      first: this.firstSubmitter(choices),
    })
    const passed = (['black', 'white'] as const).filter((seat) => !choices[seat]?.point)
    if (next.phase === 'playing') {
      await this.ctx.storage.delete('choices')
      const deadline = await this.scheduleFrame(next, await this.frameSeconds())
      this.broadcast({ type: 'frame_settled', state: next, deadline, now: Date.now(), passed })
    } else {
      await this.endGame(next, passed)
    }
  }

  private async endGame(next: GameState, passed: Seat[] = []): Promise<void> {
    await this.ctx.storage.delete('choices')
    await this.ctx.storage.setAlarm(Date.now() + IDLE_TTL_MS)
    await this.ctx.storage.put('game', next)
    this.broadcast({ type: 'frame_settled', state: next, deadline: null, now: Date.now(), passed })
    await this.recordResult(next.phase)
  }

  private async recordResult(phase: GameState['phase']): Promise<void> {
    const accounts = (await this.ctx.storage.get<Players>('accounts')) ?? {}
    const results = (['black', 'white'] as const).flatMap((seat) => {
      const email = accounts[seat]
      if (!email) return []
      const outcome: GameOutcome =
        phase === 'draw' ? 'draw' : phase === `${seat}_won` ? 'win' : 'loss'
      return [{ email, outcome }]
    })
    if (results.length === 0) return
    try {
      await this.env.ACCOUNTS.get(this.env.ACCOUNTS.idFromName('accounts')).recordResult(results)
    } catch {}
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
