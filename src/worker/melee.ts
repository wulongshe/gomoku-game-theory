import { DurableObject } from 'cloudflare:workers'
import type { Point } from '@gomoku/engine/game'
import {
  createMelee,
  dropOut,
  isLegalMeleeChoice,
  MELEE_COLORS,
  MELEE_FRAME_SECONDS,
  settleMelee,
  type Color,
  type MeleeChoices,
  type MeleeState,
} from '@gomoku/engine/melee'
import { parseMeleeClientMessage, type MeleeServerMessage } from '@/shared/protocol'

const IDLE_TTL_MS = 10 * 60 * 1000

interface Attachment {
  seat: Color
  replaced?: boolean
  draft?: { frame: number; point: Point | null }
}

type Keys = Partial<Record<Color, string>>

type Choices = Partial<Record<Color, { point: Point | null; final: boolean }>>

// 大乱斗房：3~5 个席位按颜色排队入座，全员准备后开局；每帧所有在场者提交或到点即结算。
export class Melee extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'))
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    if (request.method === 'POST') {
      if (await this.ctx.storage.get<boolean>('created')) {
        return new Response(null, { status: 409 })
      }
      const players = Number(url.searchParams.get('players'))
      await this.ctx.storage.put({ created: true, seats: MELEE_COLORS.slice(0, players) })
      await this.ctx.storage.setAlarm(Date.now() + IDLE_TTL_MS)
      return new Response(null, { status: 204 })
    }
    const created = (await this.ctx.storage.get<boolean>('created')) ?? false
    const seats = await this.seats()
    const keys = (await this.ctx.storage.get<Keys>('players')) ?? {}
    const key = url.searchParams.get('key')
    const seatOf = (k: string | null) => seats.find((seat) => k !== null && keys[seat] === k)
    const free = seats.find((seat) => !keys[seat])
    if (!url.pathname.endsWith('/ws')) {
      return Response.json({ exists: created, full: !seatOf(key) && !free })
    }
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 })
    }
    if (!created) return new Response('Room not found', { status: 404 })
    if (!key) return new Response('Missing key', { status: 400 })

    const seat = seatOf(key) ?? free
    if (!seat) return new Response('Room is full', { status: 409 })
    if (keys[seat] !== key) {
      keys[seat] = key
      await this.ctx.storage.put('players', keys)
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
    this.send(pair[1], { type: 'joined', seat, seats, frameSeconds: MELEE_FRAME_SECONDS })

    const game = await this.ctx.storage.get<MeleeState>('game')
    if (game) {
      await this.ctx.storage.delete('emptySince')
      const deadline = (await this.ctx.storage.get<number>('deadline')) ?? null
      if (game.phase === 'playing' && deadline !== null) {
        // 空房期间闹钟可能被改挂成 TTL 关房；回来后拨回结算时点，已过期就立刻结算。
        if (Date.now() >= deadline) {
          await this.settleWithDrafts(game)
          return new Response(null, { status: 101, webSocket: pair[0] })
        }
        await this.ctx.storage.setAlarm(deadline)
      }
      const frameStart = await this.ctx.storage.get<number>('frameStart')
      const choices = (await this.ctx.storage.get<Choices>('choices')) ?? {}
      this.send(pair[1], {
        type: 'start',
        state: game,
        deadline: game.phase === 'playing' ? deadline : null,
        now: Date.now(),
        elapsed: game.phase === 'playing' && frameStart ? Date.now() - frameStart : 0,
        submitted: this.finalSeats(choices),
        yourChoice: choices[seat]?.point ?? null,
      })
    } else {
      await this.broadcastLobby()
    }
    return new Response(null, { status: 101, webSocket: pair[0] })
  }

  private async seats(): Promise<Color[]> {
    return (await this.ctx.storage.get<Color[]>('seats')) ?? []
  }

  private playerSockets(): WebSocket[] {
    return this.ctx.getWebSockets().filter((ws) => !(ws.deserializeAttachment() as Attachment).replaced)
  }

  private async presentSeats(): Promise<Color[]> {
    const online = this.playerSockets().map((ws) => (ws.deserializeAttachment() as Attachment).seat)
    return (await this.seats()).filter((seat) => online.includes(seat))
  }

  private finalSeats(choices: Choices): Color[] {
    return (Object.keys(choices) as Color[]).filter((seat) => choices[seat]?.final)
  }

  private async broadcastLobby(): Promise<void> {
    const ready = (await this.ctx.storage.get<Color[]>('ready')) ?? []
    this.broadcast({ type: 'lobby', present: await this.presentSeats(), ready })
  }

  private async tryStart(): Promise<void> {
    const seats = await this.seats()
    const ready = (await this.ctx.storage.get<Color[]>('ready')) ?? []
    const present = await this.presentSeats()
    if (seats.every((seat) => ready.includes(seat) && present.includes(seat))) {
      await this.ctx.storage.delete(['choices', 'ready'])
      const game = createMelee(seats)
      const deadline = await this.scheduleFrame(game)
      this.broadcast({
        type: 'start',
        state: game,
        deadline,
        now: Date.now(),
        elapsed: 0,
        submitted: [],
        yourChoice: null,
      })
    } else {
      await this.broadcastLobby()
    }
  }

  private async scheduleFrame(game: MeleeState): Promise<number> {
    const frameStart = Date.now()
    const deadline = frameStart + MELEE_FRAME_SECONDS * 1000
    await this.ctx.storage.put({ game, frameStart, deadline })
    await this.ctx.storage.setAlarm(deadline)
    return deadline
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== 'string') return
    const msg = parseMeleeClientMessage(message)
    if (!msg) return this.send(ws, { type: 'error', message: 'malformed message' })
    const { seat } = ws.deserializeAttachment() as Attachment
    const game = await this.ctx.storage.get<MeleeState>('game')
    if (msg.type === 'leave') return this.handleLeave(ws, seat, game)
    if (msg.type === 'ready') {
      if (game) return
      const ready = (await this.ctx.storage.get<Color[]>('ready')) ?? []
      if (!ready.includes(seat)) await this.ctx.storage.put('ready', [...ready, seat])
      return this.tryStart()
    }
    if (!game || game.phase !== 'playing' || !game.active.includes(seat)) {
      return this.send(ws, { type: 'error', message: 'game not in progress' })
    }
    if (msg.frame !== game.frame) return this.send(ws, { type: 'error', message: 'stale frame' })
    if (msg.point && !isLegalMeleeChoice(game, seat, msg.point)) {
      return this.send(ws, { type: 'error', message: 'illegal point' })
    }
    const choices = (await this.ctx.storage.get<Choices>('choices')) ?? {}
    const wasFinal = !!choices[seat]?.final
    if (!msg.final) {
      const attachment = ws.deserializeAttachment() as Attachment
      ws.serializeAttachment({ ...attachment, draft: { frame: msg.frame, point: msg.point } })
      if (wasFinal) {
        delete choices[seat]
        await this.ctx.storage.put('choices', choices)
        this.broadcast({ type: 'submitted', submitted: this.finalSeats(choices) })
      }
      return
    }
    choices[seat] = { point: msg.point, final: true }
    await this.ctx.storage.put('choices', choices)
    if (!wasFinal) this.broadcast({ type: 'submitted', submitted: this.finalSeats(choices) })
    if (game.active.every((color) => choices[color]?.final)) await this.settle(game, choices)
  }

  private async handleLeave(ws: WebSocket, seat: Color, game: MeleeState | undefined): Promise<void> {
    if (game?.phase === 'playing') {
      // 中途退出即离场：其余人继续，只剩一人时终局。
      const next = dropOut(game, seat)
      await this.ctx.storage.put('game', next)
      this.broadcast({ type: 'dropped', seat, state: next })
      ws.close(1000, 'room closed')
      if (next.phase !== 'playing') return this.endGame(next)
      const choices = (await this.ctx.storage.get<Choices>('choices')) ?? {}
      if (next.active.every((color) => choices[color]?.final)) await this.settle(next, choices)
      return
    }
    if (!game) {
      // 开局前离开即让座，房间留给其他人；无人时按 TTL 关房。
      const keys = (await this.ctx.storage.get<Keys>('players')) ?? {}
      delete keys[seat]
      await this.ctx.storage.put('players', keys)
    }
    ws.close(1000, 'room closed')
  }

  async alarm(): Promise<void> {
    const game = await this.ctx.storage.get<MeleeState>('game')
    if (this.ctx.getWebSockets().length === 0) {
      if (game?.phase === 'playing') {
        const emptySince = (await this.ctx.storage.get<number>('emptySince')) ?? Date.now()
        if (Date.now() - emptySince < IDLE_TTL_MS) {
          await this.ctx.storage.put('emptySince', emptySince)
          return this.ctx.storage.setAlarm(emptySince + IDLE_TTL_MS)
        }
      }
      return this.close()
    }
    if (game?.phase !== 'playing') return this.ctx.storage.setAlarm(Date.now() + IDLE_TTL_MS)
    await this.settleWithDrafts(game)
  }

  // 到点结算：未提交者有草稿则按草稿落子，没有则弃着。
  private async settleWithDrafts(game: MeleeState): Promise<void> {
    const choices = (await this.ctx.storage.get<Choices>('choices')) ?? {}
    for (const socket of this.playerSockets()) {
      const { seat, draft } = socket.deserializeAttachment() as Attachment
      if (draft?.frame === game.frame && !choices[seat]?.final) {
        choices[seat] = { point: draft.point, final: false }
      }
    }
    await this.settle(game, choices)
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    const attachment = ws.deserializeAttachment() as Attachment
    if (attachment.replaced) return
    if (!(await this.ctx.storage.get<boolean>('created'))) return
    const remaining = this.ctx.getWebSockets().filter((other) => other !== ws)
    const game = await this.ctx.storage.get<MeleeState>('game')
    if (!game) {
      const ready = (await this.ctx.storage.get<Color[]>('ready')) ?? []
      if (ready.includes(attachment.seat)) {
        await this.ctx.storage.put('ready', ready.filter((seat) => seat !== attachment.seat))
      }
    }
    if (remaining.length === 0) {
      if (game && game.phase !== 'playing') await this.close()
      else if (game) await this.ctx.storage.put('emptySince', Date.now())
      else await this.ctx.storage.setAlarm(Date.now() + IDLE_TTL_MS)
    } else if (!game) {
      await this.broadcastLobby()
    }
  }

  private async settle(game: MeleeState, choices: Choices): Promise<void> {
    const picks: MeleeChoices = {}
    for (const color of game.active) picks[color] = choices[color]?.point ?? null
    const next = settleMelee(game, picks)
    if (next.phase === 'playing') {
      await this.ctx.storage.delete('choices')
      const deadline = await this.scheduleFrame(next)
      this.broadcast({ type: 'frame_settled', state: next, deadline, now: Date.now() })
    } else {
      await this.endGame(next)
    }
  }

  private async endGame(next: MeleeState): Promise<void> {
    await this.ctx.storage.delete(['choices', 'deadline'])
    await this.ctx.storage.setAlarm(Date.now() + IDLE_TTL_MS)
    await this.ctx.storage.put('game', next)
    this.broadcast({ type: 'frame_settled', state: next, deadline: null, now: Date.now() })
  }

  private async close(): Promise<void> {
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.close(1000, 'room closed')
      } catch {}
    }
    await this.ctx.storage.deleteAlarm()
    await this.ctx.storage.deleteAll()
  }

  private broadcast(message: MeleeServerMessage): void {
    for (const ws of this.ctx.getWebSockets()) this.send(ws, message)
  }

  private send(ws: WebSocket, message: MeleeServerMessage): void {
    try {
      ws.send(JSON.stringify(message))
    } catch {}
  }
}
