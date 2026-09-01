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
import { chooseAiMove, type Difficulty } from '@gomoku/engine/ai'
import {
  maskEmail,
  parseClientMessage,
  tournamentFrameSeconds,
  type ServerMessage,
} from '@/shared/protocol'
import type { GameOutcome } from './accounts'

const IDLE_TTL_MS = 10 * 60 * 1000

// 生产环境闹钟可能在 Date.now() 尚差几毫秒到达预定时点时就被调起（线上实证过：
// 严格 >= 判定落空 → 闹钟被改挂 10 分钟 → AI 行动点孤儿化）。判定一律容忍该偏差。
const ALARM_SKEW_MS = 1500

// 顶替真人的 AI（匹配久等兜底 / 大赛陪打 bot）：启发式单步走子（免费层 10ms CPU 限制内），
// 行为节奏拟人（见各处随机延时）。
const AI_DIFFICULTY: Difficulty = 'normal'

// 拟人节奏的对局进度插值：越下越慢、越犹豫。
function lateness(frame: number): number {
  return Math.min(1, (frame - 1) / 30)
}

// 拟人思考时长：限时局压在时限的六成与 10.5s 之内，不限时局也别让对面干等；
// 开局出手快，越到中后盘想得越久。
function aiThinkDelay(frameSeconds: number, late: number): number {
  const cap = frameSeconds ? Math.min(frameSeconds * 600, 9000) : 8000
  return 1500 + Math.random() * cap * (0.35 + 0.65 * late)
}

// 大赛 bot 的进场延时：开轮后错峰入座，别整齐划一地秒到。
function aiArriveDelay(): number {
  return 5_000 + Math.random() * 55_000
}

interface Attachment {
  seat: Seat
  spectator?: true
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

// AI 占用的席位：email 为大赛 bot 的参赛邮箱（匹配兜底 AI 无身份为 null）。
interface AiSeatInfo {
  email: string | null
  difficulty: Difficulty
}

type AiSeats = Partial<Record<Seat, AiSeatInfo>>

type AiTimes = Partial<Record<Seat, number>>

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
        entries.aiSeats = { [seat]: { email: null, difficulty: AI_DIFFICULTY } } satisfies AiSeats
        entries.players = { [seat]: crypto.randomUUID() } satisfies Players
      }
      if (url.searchParams.get('tournament') === '1') {
        const tPlayers: [string, string] = [
          url.searchParams.get('p0') ?? '',
          url.searchParams.get('p1') ?? '',
        ]
        entries.tournament = {
          round: Number(url.searchParams.get('round')),
          code: url.searchParams.get('code') ?? '',
          players: tPlayers,
        } satisfies TournamentTag
        const bots = [url.searchParams.get('ai0'), url.searchParams.get('ai1')]
        if (bots.some(Boolean)) {
          // bot 席位与参赛邮箱在建房时绑定（上报赢家要对得上号），执色随机。
          const order: [Seat, Seat] = Math.random() < 0.5 ? ['black', 'white'] : ['white', 'black']
          const aiSeats: AiSeats = {}
          const claims: Players = {}
          const arrive: AiTimes = {}
          bots.forEach((difficulty, i) => {
            if (!difficulty) return
            const seat = order[i]
            aiSeats[seat] = { email: tPlayers[i], difficulty: difficulty as Difficulty }
            claims[seat] = crypto.randomUUID()
            arrive[seat] = Date.now() + aiArriveDelay()
          })
          entries.aiSeats = aiSeats
          entries.players = claims
          entries.aiArrive = arrive
        }
      }
      await this.ctx.storage.put(entries)
      const arrivals = Object.values((entries.aiArrive as AiTimes | undefined) ?? {})
      await this.ctx.storage.setAlarm(Math.min(Date.now() + IDLE_TTL_MS, ...arrivals))
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
    if (url.searchParams.get('spectate') === '1') {
      return this.acceptSpectator(url)
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
    this.broadcast({ type: 'players', accounts: await this.displayAccounts(await this.seatEmails()) })

    const aiSeats = await this.aiSeats()
    const game = await this.ctx.storage.get<GameState>('game')
    if (game) {
      await this.ctx.storage.delete('emptySince')
      if (game.phase === 'playing' && this.playerSockets().length === 1) {
        const stale = await this.ctx.storage.get<number>('deadline')
        if (stale !== undefined && Date.now() >= stale) {
          await this.scheduleFrame(game, await this.frameSeconds())
        } else if (Object.keys(aiSeats).length) {
          // 掉线期间闹钟可能被空房逻辑改走，回来后拨回 AI 行动或结算时点。
          await this.armAlarm()
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
      if (ready.black && ready.white && this.readyToStart(aiSeats)) {
        await this.startGame()
      } else {
        await this.broadcastLobby()
        await this.scheduleAiArrivals(aiSeats, 600 + Math.random() * 2200)
      }
    }

    return new Response(null, { status: 101, webSocket: pair[0] })
  }

  // 观战连接：仅大赛房开放，且由大赛 DO 校验资格（本轮参赛且自己的对局已打完）。
  // 观战者无席位、只收广播，另发 choices 让其看到双方的草稿/提交点。
  private async acceptSpectator(url: URL): Promise<Response> {
    const tournament = await this.ctx.storage.get<TournamentTag>('tournament')
    const email = await this.accountEmail(url.searchParams.get('token'))
    let allowed = false
    if (tournament && email !== null) {
      try {
        allowed = await this.env.TOURNAMENT.get(
          this.env.TOURNAMENT.idFromName('daily'),
        ).canSpectate(email)
      } catch {}
    }
    if (!allowed) {
      return new Response('Not allowed to spectate', { status: 403 })
    }
    const pair = new WebSocketPair()
    this.ctx.acceptWebSocket(pair[1])
    pair[1].serializeAttachment({ seat: 'black', spectator: true } satisfies Attachment)
    this.send(pair[1], {
      type: 'joined',
      seat: 'black',
      frameSeconds: await this.frameSeconds(),
      mode: await this.mode(),
      tournament: true,
      spectator: true,
    })
    this.send(pair[1], {
      type: 'players',
      accounts: await this.displayAccounts(await this.seatEmails()),
    })
    const game = await this.ctx.storage.get<GameState>('game')
    if (game) {
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
        yourChoice: null,
      })
      this.send(pair[1], this.choicesMessage(choices))
    }
    return new Response(null, { status: 101, webSocket: pair[0] })
  }

  private choicesMessage(choices: Choices): ServerMessage {
    const pick = (seat: Seat) =>
      choices[seat] ? { point: choices[seat].point, final: choices[seat].final } : null
    return { type: 'choices', black: pick('black'), white: pick('white') }
  }

  private sendChoices(choices: Choices): void {
    const msg = this.choicesMessage(choices)
    for (const ws of this.ctx.getWebSockets()) {
      if ((ws.deserializeAttachment() as Attachment).spectator) this.send(ws, msg)
    }
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

  private async aiSeats(): Promise<AiSeats> {
    return (await this.ctx.storage.get<AiSeats>('aiSeats')) ?? {}
  }

  private playerSockets(): WebSocket[] {
    return this.ctx.getWebSockets().filter((ws) => {
      const attachment = ws.deserializeAttachment() as Attachment
      return !attachment.spectator && !attachment.replaced
    })
  }

  private readyToStart(aiSeats: AiSeats): boolean {
    return this.playerSockets().length === 2 - Object.keys(aiSeats).length
  }

  private async seatEmails(): Promise<Players> {
    const accounts = (await this.ctx.storage.get<Players>('accounts')) ?? {}
    const aiSeats = await this.aiSeats()
    const emailOf = (seat: Seat) => accounts[seat] ?? aiSeats[seat]?.email ?? undefined
    return { black: emailOf('black'), white: emailOf('white') }
  }

  private async armAlarm(): Promise<void> {
    const plan = (await this.ctx.storage.get<AiTimes>('aiPlan')) ?? {}
    const arrive = (await this.ctx.storage.get<AiTimes>('aiArrive')) ?? {}
    const deadline = await this.ctx.storage.get<number>('deadline')
    const targets = [...Object.values(plan), ...Object.values(arrive), deadline].filter(
      (t): t is number => t !== undefined,
    )
    await this.ctx.storage.setAlarm(targets.length ? Math.min(...targets) : Date.now() + IDLE_TTL_MS)
  }

  private async planAi(seat: Seat, delayMs: number): Promise<void> {
    const plan = (await this.ctx.storage.get<AiTimes>('aiPlan')) ?? {}
    plan[seat] = Date.now() + delayMs
    await this.ctx.storage.put('aiPlan', plan)
    await this.armAlarm()
  }

  // 隐身 AI 在真人现身后才「进场」准备；大赛 bot 的进场时点建房时已定，不覆盖。
  private async scheduleAiArrivals(aiSeats: AiSeats, delayMs: number): Promise<void> {
    const seats = Object.keys(aiSeats) as Seat[]
    if (!seats.length) return
    const ready = (await this.ctx.storage.get<SeatFlags>('ready')) ?? {}
    const arrive = (await this.ctx.storage.get<AiTimes>('aiArrive')) ?? {}
    let changed = false
    for (const seat of seats) {
      if (ready[seat] || arrive[seat] !== undefined) continue
      arrive[seat] = Date.now() + delayMs
      changed = true
    }
    if (changed) {
      await this.ctx.storage.put('aiArrive', arrive)
      await this.armAlarm()
    }
  }

  private async broadcastLobby(exclude?: WebSocket): Promise<void> {
    const sockets = this.ctx.getWebSockets().filter((ws) => ws !== exclude)
    const present = { black: false, white: false }
    for (const ws of sockets) {
      const attachment = ws.deserializeAttachment() as Attachment
      if (!attachment.replaced && !attachment.spectator) present[attachment.seat] = true
    }
    for (const seat of Object.keys(await this.aiSeats()) as Seat[]) present[seat] = true
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
    const tournament = await this.ctx.storage.get<TournamentTag>('tournament')
    if (tournament) {
      try {
        await this.env.TOURNAMENT.get(this.env.TOURNAMENT.idFromName('daily')).gameStarted({
          code: tournament.code,
        })
      } catch {}
    }
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
    // 大赛对局逐帧变时限（10s 起步、渐宽到 30s），无视房间的固定帧长。
    if (await this.ctx.storage.get<TournamentTag>('tournament')) {
      frameSeconds = tournamentFrameSeconds(game.frame)
    }
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
    for (const seat of Object.keys(await this.aiSeats()) as Seat[]) {
      await this.planAi(seat, aiThinkDelay(frameSeconds, lateness(game.frame)))
    }
    return deadline
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== 'string') return
    const msg = parseClientMessage(message)
    if (!msg) {
      return this.send(ws, { type: 'error', message: 'malformed message' })
    }
    const { seat, spectator } = ws.deserializeAttachment() as Attachment
    if (spectator) return // 观战者只读
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
      if (ready.black && ready.white && this.readyToStart(await this.aiSeats())) {
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
        const [aiSeat] = Object.keys(await this.aiSeats()) as Seat[]
        if (aiSeat) {
          await this.ctx.storage.put('aiDrawOffered', true)
          await this.planAi(aiSeat, 800 + Math.random() * 1500)
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
    this.sendChoices(choices)
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
      const [aiSeat] = Object.keys(await this.aiSeats()) as Seat[]
      if (aiSeat) {
        await this.planAi(aiSeat, 1000 + Math.random() * 2500)
      }
      return
    }
    await this.applyRematch(proposal)
  }

  private async applyRematch(proposal: RematchProposal): Promise<void> {
    await this.ctx.storage.delete([
      'game',
      'choices',
      'rematch',
      'ready',
      'deadline',
      'frameStart',
      'aiPlan',
      'aiArrive',
      'aiRethink',
    ])
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
    const aiSeats = await this.aiSeats()
    const botCount = Object.keys(aiSeats).length
    const tournament = botCount
      ? await this.ctx.storage.get<TournamentTag>('tournament')
      : undefined
    const botGame = tournament !== undefined && botCount > 0
    // 对局中有真人在场（或大赛 bot 局，无人连接也照常推进）时 AI 正常行动；
    // 赛前进场不看连接状态——闹钟偶发看不到 socket 时也不能把进场弄丢。
    const live = this.playerSockets().length > 0 || botGame
    if (botCount && (!game || live) && (await this.aiStep(game, aiSeats, tournament))) return
    if (this.ctx.getWebSockets().length === 0 && !(botGame && game?.phase === 'playing')) {
      if (game && game.phase === 'playing') {
        const emptySince = (await this.ctx.storage.get<number>('emptySince')) ?? Date.now()
        if (Date.now() - emptySince < IDLE_TTL_MS) {
          await this.ctx.storage.put('emptySince', emptySince)
          return this.ctx.storage.setAlarm(emptySince + IDLE_TTL_MS)
        }
      }
      if (
        !game &&
        !botGame &&
        (await this.ctx.storage.get<AiTimes>('aiArrive')) !== undefined
      ) {
        // 真人掉线时隐身 AI 的进场闹钟提前敲门，不能当空房超时关房。
        await this.ctx.storage.delete(['aiArrive', 'aiPlan'])
        return this.ctx.storage.setAlarm(Date.now() + IDLE_TTL_MS)
      }
      return this.close()
    }
    if (!game || game.phase !== 'playing' || (await this.frameSeconds()) === 0) {
      // 不盲设空房 TTL：若还有待办的 AI 时点（如闹钟早到没判上），拨回去自愈。
      return this.armAlarm()
    }
    const choices = (await this.ctx.storage.get<Choices>('choices')) ?? {}
    await this.settle(game, choices)
  }

  // 到点的 AI 进场/行动；返回 true 表示本次闹钟由 AI 消费（行动分支自会重挂闹钟）。
  private async aiStep(
    game: GameState | undefined,
    aiSeats: AiSeats,
    tournament: TournamentTag | undefined,
  ): Promise<boolean> {
    const now = Date.now()
    if (!game) {
      const arrive = (await this.ctx.storage.get<AiTimes>('aiArrive')) ?? {}
      const due = (Object.keys(arrive) as Seat[]).filter(
        (seat) => now >= arrive[seat]! - ALARM_SKEW_MS,
      )
      if (due.length === 0) return false
      const ready = (await this.ctx.storage.get<SeatFlags>('ready')) ?? {}
      for (const seat of due) {
        delete arrive[seat]
        ready[seat] = true
        const email = aiSeats[seat]?.email
        if (tournament && email) {
          try {
            await this.env.TOURNAMENT.get(this.env.TOURNAMENT.idFromName('daily')).checkIn({
              code: tournament.code,
              email,
            })
          } catch {}
        }
      }
      await this.ctx.storage.put({ aiArrive: arrive, ready })
      if (ready.black && ready.white && this.readyToStart(aiSeats)) {
        await this.startGame()
      } else {
        await this.broadcastLobby()
        await this.armAlarm()
      }
      return true
    }
    const plan = (await this.ctx.storage.get<AiTimes>('aiPlan')) ?? {}
    for (const seat of Object.keys(plan) as Seat[]) {
      if (now < plan[seat]! - ALARM_SKEW_MS || !aiSeats[seat]) continue
      delete plan[seat]
      await this.ctx.storage.put('aiPlan', plan)
      await this.aiAct(seat, aiSeats[seat], game, tournament)
      return true
    }
    return false
  }

  private async aiAct(
    seat: Seat,
    info: AiSeatInfo,
    game: GameState,
    tournament: TournamentTag | undefined,
  ): Promise<void> {
    if (game.phase === 'playing') {
      if (await this.ctx.storage.get<boolean>('aiDrawOffered')) {
        await this.ctx.storage.delete('aiDrawOffered')
        this.broadcast({ type: 'draw_declined' })
        return this.planAi(seat, 1200 + Math.random() * 2500)
      }
      const choices = (await this.ctx.storage.get<Choices>('choices')) ?? {}
      const current = choices[seat]
      if (current?.final) return this.armAlarm()
      const deadline = await this.ctx.storage.get<number>('deadline')
      const left = deadline !== undefined ? deadline - Date.now() : Infinity
      const submit = async (point: Point | null) => {
        choices[seat] = { point, final: true, finalAt: Date.now() }
        await this.ctx.storage.put('choices', choices)
        this.sendChoices(choices)
        this.broadcast({ type: 'opponent_submitted', submitted: true })
        const other: Seat = seat === 'black' ? 'white' : 'black'
        if (choices[other]?.final) return this.settle(game, choices)
        return this.armAlarm()
      }
      const draft = async () => {
        choices[seat] = { point: chooseAiMove(game, seat, info.difficulty), final: false }
        await this.ctx.storage.put('choices', choices)
        this.sendChoices(choices)
      }
      // 落子（草稿）后的去向在此刻预谋：要再换点的先长考 4~15s 再换（可连锁多次换点）；
      // 不换的短暂犹豫就定稿——大部分 0.5~3s，其余 3~8s。
      const scheduleNext = async () => {
        if (left > 9000 && Math.random() < 0.25) {
          const rethink = (await this.ctx.storage.get<SeatFlags>('aiRethink')) ?? {}
          rethink[seat] = true
          await this.ctx.storage.put('aiRethink', rethink)
          return this.planAi(seat, 4000 + Math.random() * 11000)
        }
        return this.planAi(
          seat,
          Math.random() < 0.7 ? 500 + Math.random() * 2500 : 3000 + Math.random() * 5000,
        )
      }
      // 节奏随对局推进变化：开局多半选完就直接提交，中后盘更常打草稿犹豫，
      // 甚至磨到帧超时让草稿自动提交——像真人越下越谨慎。
      const late = lateness(game.frame)
      if (!current) {
        if (left < 3500 || Math.random() < 0.55 - 0.4 * late) {
          return submit(chooseAiMove(game, seat, info.difficulty))
        }
        await draft()
        return scheduleNext()
      }
      const rethink = (await this.ctx.storage.get<SeatFlags>('aiRethink')) ?? {}
      if (rethink[seat]) {
        delete rethink[seat]
        await this.ctx.storage.put('aiRethink', rethink)
        await draft()
        return scheduleNext()
      }
      if (Number.isFinite(left) && Math.random() < 0.03 + 0.22 * late) {
        return this.armAlarm() // 不再行动，草稿在帧超时自动提交
      }
      return submit(current.point)
    }
    if (tournament) return this.armAlarm()
    const rematch = (await this.ctx.storage.get<RematchProposals>('rematch')) ?? {}
    const proposal = rematch[seat === 'black' ? 'white' : 'black']
    if (proposal) {
      await this.applyRematch(proposal)
      return this.scheduleAiArrivals(await this.aiSeats(), 800 + Math.random() * 2000)
    }
    return this.armAlarm()
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    const attachment = ws.deserializeAttachment() as Attachment
    if (attachment.replaced || attachment.spectator) return
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
        // 大赛 bot 的进场时点保留（真人始终缺席时 bot 仍到场 → 轮空胜）；隐身 AI 则随真人离场作罢。
        if (!(await this.ctx.storage.get<TournamentTag>('tournament'))) {
          await this.ctx.storage.delete(['aiArrive', 'aiPlan'])
        }
        await this.armAlarm()
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
      await this.ctx.storage.delete(['choices', 'aiRethink'])
      const deadline = await this.scheduleFrame(next, await this.frameSeconds())
      this.broadcast({ type: 'frame_settled', state: next, deadline, now: Date.now(), passed })
    } else {
      await this.endGame(next, passed)
    }
  }

  private async endGame(next: GameState, passed: Seat[] = []): Promise<void> {
    await this.ctx.storage.delete(['choices', 'aiPlan', 'aiRethink', 'aiDrawOffered'])
    await this.ctx.storage.setAlarm(Date.now() + IDLE_TTL_MS)
    await this.ctx.storage.put('game', next)
    this.broadcast({ type: 'frame_settled', state: next, deadline: null, now: Date.now(), passed })
    await this.recordResult(next.phase)
  }

  private async recordResult(phase: GameState['phase']): Promise<void> {
    const tournament = await this.ctx.storage.get<TournamentTag>('tournament')
    if (tournament) {
      // 赢家按座位→email 实表算（bot 席位取建房时绑定的参赛邮箱）、按房号上报
      //（座位颜色由连接顺序/建房随机定，与大赛无关）；大赛对局独立结算，不计入普通战绩/ELO。
      const emails = await this.seatEmails()
      const winnerEmail =
        phase === 'black_won'
          ? (emails.black ?? null)
          : phase === 'white_won'
            ? (emails.white ?? null)
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
    // AI 顶替局不入战绩/ELO，防止空窗期刷分。
    if (Object.keys(await this.aiSeats()).length) return
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
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.close(1000, 'room closed')
      } catch {}
    }
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
