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
} from '@gomoku/engine/game'
import { searchBestMove } from '@gomoku/engine/mcts'
import type { Difficulty } from '@gomoku/engine/ai'
import { maskEmail, parseClientMessage, type ServerMessage } from '@/shared/protocol'
import type { GameOutcome } from './accounts'

const IDLE_TTL_MS = 10 * 60 * 1000

// 匹配久等无人时顶替真人的 AI：中等棋力，行为节奏拟人（见各处随机延时）。
const AI_DIFFICULTY: Difficulty = 'normal'

// 拟人思考时长：限时局压在时限的六成与 10.5s 之内，不限时局也别让对面干等。
function aiThinkDelay(frameSeconds: number): number {
  const cap = frameSeconds ? Math.min(frameSeconds * 600, 9000) : 8000
  return 1500 + Math.random() * cap
}

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

interface TournamentTag {
  round: number
  code: string
  players: [string, string]
}

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
      const entries: Record<string, unknown> = { created: true, frameSeconds, mode }
      if (url.searchParams.get('ai') === '1') {
        // AI 随机占一席（免得对手总执同色露馅），席位钥匙不可猜、真人只能坐另一边。
        const seat: Seat = Math.random() < 0.5 ? 'black' : 'white'
        entries.ai = seat
        entries.players = { [seat]: crypto.randomUUID() } satisfies Players
      }
      if (url.searchParams.get('tournament') === '1') {
        entries.tournament = {
          round: Number(url.searchParams.get('round')),
          code: url.searchParams.get('code') ?? '',
          players: [url.searchParams.get('p0') ?? '', url.searchParams.get('p1') ?? ''],
        } satisfies TournamentTag
      }
      await this.ctx.storage.put(entries)
      await this.ctx.storage.setAlarm(Date.now() + IDLE_TTL_MS)
      return new Response(null, { status: 204 })
    }
    const created = (await this.ctx.storage.get<boolean>('created')) ?? false
    if (!url.pathname.endsWith('/ws')) {
      const players = (await this.ctx.storage.get<Players>('players')) ?? {}
      const accounts = (await this.ctx.storage.get<Players>('accounts')) ?? {}
      const key = url.searchParams.get('key')
      const email = await this.accountEmail(url.searchParams.get('token'))
      const hasSeat =
        !players.black ||
        !players.white ||
        key === players.black ||
        key === players.white ||
        (email !== null && (accounts.black === email || accounts.white === email))
      return Response.json({ exists: created, full: !hasSeat })
    }
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 })
    }
    if (!created) {
      return new Response('Room not found', { status: 404 })
    }
    const key = url.searchParams.get('key')
    if (!key) {
      return new Response('Missing key', { status: 400 })
    }

    const players = (await this.ctx.storage.get<Players>('players')) ?? {}
    const accounts = (await this.ctx.storage.get<Players>('accounts')) ?? {}
    const email = await this.accountEmail(url.searchParams.get('token'))
    const tournament = await this.ctx.storage.get<TournamentTag>('tournament')
    if (tournament && (email === null || !tournament.players.includes(email))) {
      return new Response('Not a tournament participant', { status: 403 })
    }
    let seat: Seat
    if (players.black === key) seat = 'black'
    else if (players.white === key) seat = 'white'
    else if (email !== null && accounts.black === email) seat = 'black'
    else if (email !== null && accounts.white === email) seat = 'white'
    else if (!players.black) seat = 'black'
    else if (!players.white) seat = 'white'
    else return new Response('Room is full', { status: 409 })

    if (players[seat] !== key) {
      players[seat] = key
      await this.ctx.storage.put('players', players)
    }
    if (email !== null && accounts[seat] !== email) {
      accounts[seat] = email
      await this.ctx.storage.put('accounts', accounts)
    }
    if (tournament && email !== null) {
      try {
        await this.env.TOURNAMENT.get(this.env.TOURNAMENT.idFromName('daily')).checkIn({
          code: tournament.code,
          email,
        })
      } catch {}
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
      ...(tournament && { tournament: true as const }),
    })
    this.broadcast({ type: 'players', accounts: await this.displayAccounts(accounts) })

    const aiSeat = await this.aiSeat()
    const game = await this.ctx.storage.get<GameState>('game')
    if (game) {
      await this.ctx.storage.delete('emptySince')
      if (game.phase === 'playing' && this.ctx.getWebSockets().length === 1) {
        const stale = await this.ctx.storage.get<number>('deadline')
        if (stale !== undefined && Date.now() >= stale) {
          await this.scheduleFrame(game, await this.frameSeconds())
        } else if (aiSeat) {
          // 掉线期间闹钟可能被空房逻辑改走，回来后拨回 AI 行动或结算时点。
          const targets = [
            await this.ctx.storage.get<number>('aiActAt'),
            await this.ctx.storage.get<number>('deadline'),
          ].filter((t): t is number => t !== undefined)
          await this.ctx.storage.setAlarm(
            targets.length ? Math.min(...targets) : Date.now() + IDLE_TTL_MS,
          )
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
      if (ready.black && ready.white && this.ctx.getWebSockets().length === (aiSeat ? 1 : 2)) {
        await this.startGame()
      } else {
        await this.broadcastLobby()
        if (aiSeat && !ready[aiSeat]) {
          await this.armAiAlarm(600 + Math.random() * 2200)
        }
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

  private aiSeat(): Promise<Seat | undefined> {
    return this.ctx.storage.get<Seat>('ai')
  }

  // AI 的下一次行动时点：闹钟取行动点与帧结算点的较早者，行动后各分支自会拨回。
  private async armAiAlarm(delayMs: number): Promise<void> {
    const at = Date.now() + delayMs
    await this.ctx.storage.put('aiActAt', at)
    const deadline = await this.ctx.storage.get<number>('deadline')
    await this.ctx.storage.setAlarm(deadline !== undefined ? Math.min(at, deadline) : at)
  }

  private async broadcastLobby(exclude?: WebSocket): Promise<void> {
    const sockets = this.ctx.getWebSockets().filter((ws) => ws !== exclude)
    const present = { black: false, white: false }
    for (const ws of sockets) {
      const attachment = ws.deserializeAttachment() as Attachment
      if (!attachment.replaced) present[attachment.seat] = true
    }
    const aiSeat = await this.aiSeat()
    if (aiSeat) present[aiSeat] = true
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
    let deadline: number | null = null
    if (frameSeconds === 0) {
      await this.ctx.storage.delete('deadline')
      await this.ctx.storage.put({ game, frameStart })
      await this.ctx.storage.setAlarm(frameStart + IDLE_TTL_MS)
    } else {
      deadline = frameStart + frameSeconds * 1000
      await this.ctx.storage.put({ game, frameStart, deadline })
      await this.ctx.storage.setAlarm(deadline)
    }
    if (await this.aiSeat()) {
      await this.armAiAlarm(aiThinkDelay(frameSeconds))
    }
    return deadline
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
      return this.handleLeave(ws, seat, game)
    }
    if (msg.type === 'ready') {
      if (game) return
      const ready = (await this.ctx.storage.get<SeatFlags>('ready')) ?? {}
      if (!ready[seat]) {
        ready[seat] = true
        await this.ctx.storage.put('ready', ready)
      }
      if (
        ready.black &&
        ready.white &&
        this.ctx.getWebSockets().length === ((await this.aiSeat()) ? 1 : 2)
      ) {
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
        if (await this.aiSeat()) {
          await this.ctx.storage.put('aiDrawOffered', true)
          await this.armAiAlarm(800 + Math.random() * 1500)
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
      if (await this.aiSeat()) {
        await this.armAiAlarm(1000 + Math.random() * 2500)
      }
      return
    }
    await this.applyRematch(proposal)
  }

  private async applyRematch(proposal: RematchProposal): Promise<void> {
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
      if (!game && (await this.ctx.storage.get<number>('aiActAt')) !== undefined) {
        // 真人掉线时 AI 行动闹钟提前敲门，不能当空房超时关房。
        await this.ctx.storage.delete('aiActAt')
        return this.ctx.storage.setAlarm(Date.now() + IDLE_TTL_MS)
      }
      return this.close()
    }
    const aiActAt = await this.ctx.storage.get<number>('aiActAt')
    if (aiActAt !== undefined && Date.now() >= aiActAt) {
      return this.aiAct(game)
    }
    if (!game || game.phase !== 'playing' || (await this.frameSeconds()) === 0) {
      return this.ctx.storage.setAlarm(Date.now() + IDLE_TTL_MS)
    }
    const choices = (await this.ctx.storage.get<Choices>('choices')) ?? {}
    await this.settle(game, choices)
  }

  // AI 到点行动，按房间当前阶段推断该做什么：备战点准备、对局中落子/回应求和、终局应答再来一局。
  private async aiAct(game: GameState | undefined): Promise<void> {
    await this.ctx.storage.delete('aiActAt')
    const aiSeat = await this.aiSeat()
    if (!aiSeat) {
      return this.ctx.storage.setAlarm(Date.now() + IDLE_TTL_MS)
    }
    const humanSeat: Seat = aiSeat === 'black' ? 'white' : 'black'
    if (!game) {
      const ready = (await this.ctx.storage.get<SeatFlags>('ready')) ?? {}
      if (!ready[aiSeat]) {
        ready[aiSeat] = true
        await this.ctx.storage.put('ready', ready)
      }
      if (ready.black && ready.white) {
        return this.startGame()
      }
      await this.ctx.storage.setAlarm(Date.now() + IDLE_TTL_MS)
      return this.broadcastLobby()
    }
    if (game.phase === 'playing') {
      if (await this.ctx.storage.get<boolean>('aiDrawOffered')) {
        await this.ctx.storage.delete('aiDrawOffered')
        this.broadcast({ type: 'draw_declined' })
        return this.armAiAlarm(1200 + Math.random() * 2500)
      }
      const choices = (await this.ctx.storage.get<Choices>('choices')) ?? {}
      if (!choices[aiSeat]?.final) {
        const point = searchBestMove(game, aiSeat, AI_DIFFICULTY)
        choices[aiSeat] = { point, final: true, finalAt: Date.now() }
        await this.ctx.storage.put('choices', choices)
        this.broadcast({ type: 'opponent_submitted', submitted: true })
        if (choices[humanSeat]?.final) {
          return this.settle(game, choices)
        }
      }
      const deadline = await this.ctx.storage.get<number>('deadline')
      return this.ctx.storage.setAlarm(deadline ?? Date.now() + IDLE_TTL_MS)
    }
    const rematch = (await this.ctx.storage.get<RematchProposals>('rematch')) ?? {}
    const proposal = rematch[humanSeat]
    if (proposal) {
      await this.applyRematch(proposal)
      return this.armAiAlarm(800 + Math.random() * 2000)
    }
    return this.ctx.storage.setAlarm(Date.now() + IDLE_TTL_MS)
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
      else {
        await this.ctx.storage.delete('aiActAt')
        await this.ctx.storage.setAlarm(Date.now() + IDLE_TTL_MS)
      }
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
    await this.ctx.storage.delete(['choices', 'aiActAt', 'aiDrawOffered'])
    await this.ctx.storage.setAlarm(Date.now() + IDLE_TTL_MS)
    await this.ctx.storage.put('game', next)
    this.broadcast({ type: 'frame_settled', state: next, deadline: null, now: Date.now(), passed })
    await this.recordResult(next.phase)
  }

  private async recordResult(phase: GameState['phase']): Promise<void> {
    // AI 顶替局不入战绩/ELO，防止空窗期刷分。
    if (await this.aiSeat()) return
    const accounts = (await this.ctx.storage.get<Players>('accounts')) ?? {}
    const tournament = await this.ctx.storage.get<TournamentTag>('tournament')
    if (tournament) {
      // 赢家按座位→email 实表算、按房号上报（座位颜色由连接顺序定，与大赛无关）；
      // 大赛对局独立结算，不计入普通战绩/ELO。
      const winnerEmail =
        phase === 'black_won'
          ? (accounts.black ?? null)
          : phase === 'white_won'
            ? (accounts.white ?? null)
            : null
      const game = await this.ctx.storage.get<GameState>('game')
      try {
        await this.env.TOURNAMENT.get(this.env.TOURNAMENT.idFromName('daily')).reportResult({
          code: tournament.code,
          round: tournament.round,
          winnerEmail,
          moves: game?.frame ?? 0,
        })
      } catch {}
      return
    }
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
