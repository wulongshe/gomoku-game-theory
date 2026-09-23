import { DurableObject } from 'cloudflare:workers'
import {
  createGame,
  FRAME_SECONDS,
  isLegalChoice,
  settleFrame,
  type GameState,
  type Point,
  type Seat,
} from '@gomoku/engine/game'
import { assessPosition, decideAiMove, type Difficulty } from '@gomoku/engine/ai'
import { maskEmail, parseClientMessage, type FrameMoves, type ServerMessage } from '@/shared/protocol'
import type { GameOutcome } from './accounts'

const IDLE_TTL_MS = 10 * 60 * 1000

// 生产环境闹钟可能在 Date.now() 尚差几毫秒到达预定时点时就被调起（线上实证过：
// 严格 >= 判定落空 → 闹钟被改挂 10 分钟 → AI 行动点孤儿化）。判定一律容忍该偏差。
const ALARM_SKEW_MS = 1500

// 匹配久等时顶替真人的隐身 AI 走启发式单步（免费层 10ms CPU 限制内），节奏拟人（见各处随机延时）。
const AI_DIFFICULTY: Difficulty = 'normal'
// 拟人性格：绝望局按此概率认输、长局均势时按此倾向接受求和。
const AI_RESIGN_CHANCE = 0.05
const AI_DRAWISH = 0.12

const TIERS: Difficulty[] = ['easy', 'normal', 'hard', 'master']

// 每局实际棋力在基准 ±1 档内浮动（0.6 基准、上下各 0.2，越界收回），像真人的状态起伏。
function gameDifficulty(base: Difficulty): Difficulty {
  const i = TIERS.indexOf(base)
  const r = Math.random()
  const j = r < 0.6 ? i : r < 0.8 ? i - 1 : i + 1
  return TIERS[Math.max(0, Math.min(TIERS.length - 1, j))]
}

// 拟人节奏的对局进度插值：越下越慢、越犹豫。
function lateness(frame: number): number {
  return Math.min(1, (frame - 1) / 30)
}

// 开帧后的「反应」延时：先看棋再落子，取帧长的一段（封顶 18s）再按手数渐增——开局手快、
// 中后盘渐慢，固定帧长的随机匹配也有节奏变化；均势岔路口的额外长考再由 aiThinkTime 按局面
// 加码。无限时帧按一个较长的名义帧长取值。
function aiReaction(frameMs: number, frame: number): number {
  const span = Math.min(frameMs * 0.6, 18_000) * (0.5 + 0.5 * lateness(frame))
  return span * (0.3 + Math.random() * 0.7)
}

// 对面是真人时不看回合数，直接跟对方本局的平均提交用时走，只叠一层随回合渐大的随机浮动。
function aiMirrorPace(avgMs: number, frame: number): number {
  const amp = 0.15 + 0.35 * lateness(frame)
  return Math.max(600, avgMs * (1 + (Math.random() * 2 - 1) * amp))
}

// 想好一手的墙钟时长：紧迫度越高（均势岔路口 + 中后盘）想得越久，必应/唯一手/可取胜近乎秒下。
// 上限始终由调用处按 budget 与帧长 10% 余量收口，绝不磨到超时。
function aiThinkTime(criticality: number, late: number): number {
  const base = 250 + criticality * (2200 + 3500 * late)
  return base * (0.65 + Math.random() * 0.7)
}

// 提交时限随手数放宽，越往后可以长考。
function aiSubmitCap(frame: number): number {
  return 10_000 + Math.floor((frame - 1) / 5) * 5_000
}

interface Attachment {
  seat: Seat
  replaced?: boolean
  // 真人草稿挂在连接附件上（不占存储行、熬过 DO 休眠），帧超时并入自动提交；连接断开草稿即弃。
  draft?: { frame: number; point: Point | null }
}

type Players = Partial<Record<Seat, string>>

type Choices = Partial<Record<Seat, { point: Point | null; final: boolean }>>

type SeatFlags = Partial<Record<Seat, boolean>>

// 再来一局提案：各座位提出的每回合秒数。
type RematchProposals = Partial<Record<Seat, number>>

interface AiSeatInfo {
  difficulty: Difficulty
}

type AiSeats = Partial<Record<Seat, AiSeatInfo>>

// 真人本局各帧的提交用时累计，供 bot 跟节奏。
type Pace = Partial<Record<Seat, { sum: number; n: number }>>

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
      const entries: Record<string, unknown> = { created: true, frameSeconds }
      if (url.searchParams.get('matched') === '1') entries.matched = true
      if (url.searchParams.get('ai') === '1') {
        // AI 随机占一席（免得对手总执同色露馅），席位钥匙不可猜、真人只能坐另一边。
        const seat: Seat = Math.random() < 0.5 ? 'black' : 'white'
        // 棋力像真人般起伏：在基准档 ±1 内随机浮动，而非每局都同一档。
        entries.aiSeats = { [seat]: { difficulty: gameDifficulty(AI_DIFFICULTY) } } satisfies AiSeats
        entries.players = { [seat]: crypto.randomUUID() } satisfies Players
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
    this.send(pair[1], { type: 'joined', seat, frameSeconds: await this.frameSeconds() })
    this.broadcast({ type: 'players', accounts: await this.displayAccounts(accounts) })

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
      this.notifyPeers(pair[1], { type: 'opponent_returned' })
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
    return this.ctx.getWebSockets().filter((ws) => !(ws.deserializeAttachment() as Attachment).replaced)
  }

  private notifyPeers(sender: WebSocket | null, message: ServerMessage): void {
    for (const ws of this.playerSockets()) {
      if (ws !== sender) this.send(ws, message)
    }
  }

  private readyToStart(aiSeats: AiSeats): boolean {
    return this.playerSockets().length === 2 - Object.keys(aiSeats).length
  }

  private async armAlarm(): Promise<void> {
    const plan = (await this.ctx.storage.get<AiTimes>('aiPlan')) ?? {}
    const arrive = (await this.ctx.storage.get<AiTimes>('aiArrive')) ?? {}
    const deadline = await this.ctx.storage.get<number>('deadline')
    const targets = [...Object.values(plan), ...Object.values(arrive), deadline].filter(
      (t): t is number => t !== undefined,
    )
    if (!targets.length) return this.ctx.storage.setAlarm(Date.now() + IDLE_TTL_MS)
    // 已到期的目标不能原样回设：线上把设在过去/与刚响时点相同的闹钟归并到平台约 60s
    // 一轮的补扫才触发（wrangler tail 实测 lag≈59s，本地 workerd 则立即补发），表现为
    // 倒计时归零后整帧卡住。钳到严格未来的时点，平台才视为新闹钟立即排期。
    await this.ctx.storage.setAlarm(Math.max(Math.min(...targets), Date.now() + 100))
  }

  private async planAi(seat: Seat, delayMs: number): Promise<void> {
    const plan = (await this.ctx.storage.get<AiTimes>('aiPlan')) ?? {}
    plan[seat] = Date.now() + delayMs
    await this.ctx.storage.put('aiPlan', plan)
    await this.armAlarm()
  }

  // 隐身 AI 在真人现身后才「进场」准备。
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
      if (!attachment.replaced) present[attachment.seat] = true
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

  private async startGame(): Promise<void> {
    const game = createGame()
    const frameSeconds = await this.frameSeconds()
    await this.ctx.storage.delete(['choices', 'rematch', 'ready', 'pace'])
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
    const reactionFrameMs = frameSeconds > 0 ? frameSeconds * 1000 : 40_000
    for (const seat of Object.keys(await this.aiSeats()) as Seat[]) {
      const pace = await this.humanPace(seat)
      await this.planAi(
        seat,
        pace === null
          ? aiReaction(reactionFrameMs, game.frame)
          : Math.min(aiMirrorPace(pace, game.frame), reactionFrameMs * 0.9 - 1000),
      )
    }
    return deadline
  }

  // 对面真人本局的平均提交用时；对面是 bot 或还没提交过则为 null。
  private async humanPace(seat: Seat): Promise<number | null> {
    const other: Seat = seat === 'black' ? 'white' : 'black'
    if ((await this.aiSeats())[other]) return null
    const sample = ((await this.ctx.storage.get<Pace>('pace')) ?? {})[other]
    return sample?.n ? sample.sum / sample.n : null
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
      if (ready.black && ready.white && this.readyToStart(await this.aiSeats())) {
        return this.startGame()
      }
      return this.broadcastLobby()
    }
    if (msg.type === 'rematch') {
      return this.handleRematch(ws, seat, game, msg.frameSeconds)
    }
    if (msg.type === 'rematch_decline') {
      if (game && game.phase !== 'playing') {
        await this.ctx.storage.delete('rematch')
        this.notifyPeers(ws, { type: 'rematch_declined' })
      }
      return
    }
    if (msg.type === 'resign' || msg.type === 'draw_offer' || msg.type === 'draw_response') {
      if (!game || game.phase !== 'playing') {
        return this.send(ws, { type: 'error', message: 'game not in progress' })
      }
      if (msg.type === 'resign') {
        this.notifyPeers(ws, { type: 'opponent_resigned', left: false })
        return this.endGame({
          ...game,
          phase: seat === 'black' ? 'white_won' : 'black_won',
          cleared: [],
        })
      }
      if (msg.type === 'draw_offer') {
        this.notifyPeers(ws, { type: 'draw_offered' })
        const [aiSeat] = Object.keys(await this.aiSeats()) as Seat[]
        if (aiSeat) {
          await this.ctx.storage.put('aiDrawOffered', seat)
          await this.planAi(aiSeat, 800 + Math.random() * 1500)
        }
        return
      }
      if (msg.accept) {
        return this.endGame({ ...game, phase: 'draw', cleared: [] })
      }
      this.notifyPeers(ws, { type: 'draw_declined' })
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
    if (!msg.final) {
      const attachment = ws.deserializeAttachment() as Attachment
      ws.serializeAttachment({
        ...attachment,
        draft: { frame: msg.frame, point: msg.point },
      } satisfies Attachment)
      if (wasFinal) {
        delete choices[seat]
        await this.ctx.storage.put('choices', choices)
        for (const other of this.ctx.getWebSockets()) {
          if (other !== ws) this.send(other, { type: 'opponent_submitted', submitted: false })
        }
      }
      return
    }
    choices[seat] = { point: msg.point, final: true }
    await this.ctx.storage.put('choices', choices)
    if (!wasFinal) {
      const frameStart = await this.ctx.storage.get<number>('frameStart')
      if (frameStart !== undefined) {
        const pace = (await this.ctx.storage.get<Pace>('pace')) ?? {}
        const prev = pace[seat] ?? { sum: 0, n: 0 }
        pace[seat] = { sum: prev.sum + (Date.now() - frameStart), n: prev.n + 1 }
        await this.ctx.storage.put('pace', pace)
      }
      for (const other of this.ctx.getWebSockets()) {
        if (other !== ws) this.send(other, { type: 'opponent_submitted', submitted: true })
      }
    }
    if (choices.black?.final && choices.white?.final) {
      await this.settle(game, choices)
    }
  }

  private async handleLeave(
    ws: WebSocket,
    seat: Seat,
    game: GameState | undefined,
  ): Promise<void> {
    if (game && game.phase === 'playing') {
      // 中途退出 = 认输判负，但不立即拆房：终局照常入库留给对方复盘/刷新后重看，
      // 只送走退出者，空房 TTL 到点再关——立即 deleteAll 会让掉线的赢方回来撞「房间不存在」。
      const resigned: GameState = {
        ...game,
        phase: seat === 'black' ? 'white_won' : 'black_won',
        cleared: [],
      }
      this.notifyPeers(ws, { type: 'opponent_resigned', left: true })
      await this.endGame(resigned)
      ws.close(1000, 'room closed')
      return
    }
    for (const socket of this.ctx.getWebSockets()) {
      socket.close(1000, 'room closed')
    }
    await this.close()
  }

  private async handleRematch(
    ws: WebSocket,
    seat: Seat,
    game: GameState | undefined,
    frameSeconds: number,
  ): Promise<void> {
    if (!game || game.phase === 'playing') {
      return this.send(ws, { type: 'error', message: 'game not finished' })
    }
    const rematch = (await this.ctx.storage.get<RematchProposals>('rematch')) ?? {}
    if (rematch[seat === 'black' ? 'white' : 'black'] !== frameSeconds) {
      rematch[seat] = frameSeconds
      await this.ctx.storage.put('rematch', rematch)
      this.notifyPeers(ws, { type: 'rematch_requested', frameSeconds })
      const [aiSeat] = Object.keys(await this.aiSeats()) as Seat[]
      if (aiSeat) {
        await this.planAi(aiSeat, 1000 + Math.random() * 2500)
      }
      return
    }
    await this.applyRematch(frameSeconds)
  }

  private async applyRematch(frameSeconds: number): Promise<void> {
    await this.ctx.storage.delete([
      'game',
      'choices',
      'rematch',
      'ready',
      'deadline',
      'frameStart',
      'aiPlan',
      'aiArrive',
      'pace',
    ])
    await this.ctx.storage.put('frameSeconds', frameSeconds)
    await this.ctx.storage.setAlarm(Date.now() + IDLE_TTL_MS)
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = socket.deserializeAttachment() as Attachment
      this.send(socket, { type: 'joined', seat: attachment.seat, frameSeconds })
    }
    await this.broadcastLobby()
  }

  async alarm(): Promise<void> {
    const game = await this.ctx.storage.get<GameState>('game')
    const aiSeats = await this.aiSeats()
    // 对局中有真人在场时 AI 正常行动；赛前进场不看连接状态——闹钟偶发看不到 socket 时也不能把进场弄丢。
    const live = this.playerSockets().length > 0
    if (Object.keys(aiSeats).length && (!game || live) && (await this.aiStep(game, aiSeats))) return
    if (this.ctx.getWebSockets().length === 0) {
      if (game && game.phase === 'playing') {
        const emptySince = (await this.ctx.storage.get<number>('emptySince')) ?? Date.now()
        if (Date.now() - emptySince < IDLE_TTL_MS) {
          await this.ctx.storage.put('emptySince', emptySince)
          return this.ctx.storage.setAlarm(emptySince + IDLE_TTL_MS)
        }
      }
      if (!game && (await this.ctx.storage.get<AiTimes>('aiArrive')) !== undefined) {
        // 真人掉线时隐身 AI 的进场闹钟提前敲门，不能当空房超时关房。
        await this.ctx.storage.delete(['aiArrive', 'aiPlan'])
        return this.ctx.storage.setAlarm(Date.now() + IDLE_TTL_MS)
      }
      return this.close()
    }
    if (!game || game.phase !== 'playing' || (await this.frameSeconds()) === 0) {
      // 终局房把残留 deadline 清掉（老版本 endGame 不删，存量房间靠这里自愈）。
      if (game && game.phase !== 'playing') await this.ctx.storage.delete('deadline')
      // 不盲设空房 TTL：若还有待办的 AI 时点（如闹钟早到没判上），拨回去自愈。
      return this.armAlarm()
    }
    const choices = (await this.ctx.storage.get<Choices>('choices')) ?? {}
    for (const socket of this.playerSockets()) {
      const { seat, draft } = socket.deserializeAttachment() as Attachment
      if (draft?.frame === game.frame && !choices[seat]?.final) {
        choices[seat] = { point: draft.point, final: false }
      }
    }
    await this.settle(game, choices)
  }

  // 到点的 AI 进场/行动；返回 true 表示本次闹钟由 AI 消费（行动分支自会重挂闹钟）。
  private async aiStep(game: GameState | undefined, aiSeats: AiSeats): Promise<boolean> {
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
      await this.aiAct(seat, aiSeats[seat], game)
      return true
    }
    return false
  }

  private async aiAct(seat: Seat, info: AiSeatInfo, game: GameState): Promise<void> {
    if (game.phase === 'playing') {
      // 求和标志记着发起方座位：AI 自己发起的求和不由自己应答。
      const offered = await this.ctx.storage.get<Seat>('aiDrawOffered')
      if (offered && offered !== seat) {
        await this.ctx.storage.delete('aiDrawOffered')
        return this.aiRespondDraw(seat, info, game)
      }
      const choices = (await this.ctx.storage.get<Choices>('choices')) ?? {}
      const current = choices[seat]
      if (current?.final) return this.armAlarm()
      const deadline = await this.ctx.storage.get<number>('deadline')
      const left = deadline !== undefined ? deadline - Date.now() : Infinity
      const submit = async (point: Point | null) => {
        choices[seat] = { point, final: true }
        await this.ctx.storage.put('choices', choices)
        this.broadcast({ type: 'opponent_submitted', submitted: true })
        const other: Seat = seat === 'black' ? 'white' : 'black'
        if (choices[other]?.final) return this.settle(game, choices)
        return this.armAlarm()
      }
      // 思考时长随局面而定：必应/唯一手/可取胜近乎秒下，均势岔路口才犹豫长考。
      // 总耗时压在 aiSubmitCap 内，且至少留出帧长 10% 的余量提交，绝不磨到超时。
      const late = lateness(game.frame)
      const frameStart = (await this.ctx.storage.get<number>('frameStart')) ?? Date.now()
      const budget = aiSubmitCap(game.frame) - (Date.now() - frameStart)
      const slack =
        deadline !== undefined ? left - (deadline - frameStart) * 0.1 : Infinity
      if (!current) {
        const decision = decideAiMove(game, seat, info.difficulty)
        // 绝望局（对手已成己方挡不全的叉）小概率认输——真人不会每盘都磨到底。
        if (decision.losing && Math.random() < AI_RESIGN_CHANCE) {
          return this.aiResign(seat, game)
        }
        // 八十回合开外的拉锯多半已成死局：不占优时按概率主动求和，被拒了后续回合还会再随机发起。
        if (game.frame > 80 && !decision.commanding && !offered && Math.random() < 0.2) {
          this.notifyPeers(null, { type: 'draw_offered' })
        }
        const point = decision.point
        // 跟真人节奏时等待已全放在开帧延时里，到点即交。
        if ((await this.humanPace(seat)) !== null) return submit(point)
        if (left < 3500 || budget < 4000 || slack < 1000) return submit(point)
        const think = aiThinkTime(decision.criticality, late)
        if (think <= 600) return submit(point) // 明显手：略一思忖即交（≈秒下）
        choices[seat] = { point, final: false }
        await this.ctx.storage.put('choices', choices)
        return this.planAi(seat, Math.min(think, Math.max(500, budget), slack))
      }
      return submit(current.point)
    }
    const rematch = (await this.ctx.storage.get<RematchProposals>('rematch')) ?? {}
    const proposal = rematch[seat === 'black' ? 'white' : 'black']
    if (proposal !== undefined) {
      await this.applyRematch(proposal)
      return this.scheduleAiArrivals(await this.aiSeats(), 800 + Math.random() * 2000)
    }
    return this.armAlarm()
  }

  // 真人求和时的回应：长局且己方未占上风才按概率接受，落后时更愿意握手言和；否则婉拒后照常出手。
  private async aiRespondDraw(seat: Seat, info: AiSeatInfo, game: GameState): Promise<void> {
    // 只需胜负态势判断，走轻量研判（不做选点的虚拟对弈）。
    const { commanding, losing } = assessPosition(game, seat, info.difficulty)
    // 落后或八十回合开外的拉锯，都更愿意握手言和；同一局被求和，第二次必接受。
    const asked = ((await this.ctx.storage.get<number>('aiDrawAsked')) ?? 0) + 1
    await this.ctx.storage.put('aiDrawAsked', asked)
    const accept =
      !commanding &&
      game.frame >= 12 &&
      (asked >= 2 ||
        Math.random() <
          AI_DRAWISH + (losing ? 0.35 : 0) + (game.frame > 80 ? 0.35 : 0) + (asked - 1) * 0.15)
    if (accept) return this.endGame({ ...game, phase: 'draw', cleared: [] })
    this.notifyPeers(null, { type: 'draw_declined' })
    // 求和往返吃掉了本帧的行动时点：改约的落子必须仍留在截止前（含 10% 余量），否则会白丢一帧。
    const deadline = await this.ctx.storage.get<number>('deadline')
    const frameStart = (await this.ctx.storage.get<number>('frameStart')) ?? Date.now()
    let delay = 1200 + Math.random() * 2500
    if (deadline !== undefined) {
      delay = Math.min(delay, deadline - Date.now() - (deadline - frameStart) * 0.1)
    }
    return this.planAi(seat, Math.max(0, delay))
  }

  private async aiResign(seat: Seat, game: GameState): Promise<void> {
    this.notifyPeers(null, { type: 'opponent_resigned', left: false })
    await this.endGame({
      ...game,
      phase: seat === 'black' ? 'white_won' : 'black_won',
      cleared: [],
    })
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    const attachment = ws.deserializeAttachment() as Attachment
    if (attachment.replaced) return
    if (!(await this.ctx.storage.get<boolean>('created'))) return
    const remaining = this.ctx.getWebSockets().filter((other) => other !== ws)
    this.notifyPeers(ws, { type: 'opponent_left' })
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
        // 隐身 AI 的进场随真人离场作罢。
        await this.ctx.storage.delete(['aiArrive', 'aiPlan'])
        await this.armAlarm()
      }
    } else if (!game) {
      await this.broadcastLobby(ws)
    }
  }

  private async settle(game: GameState, choices: Choices): Promise<void> {
    const next = settleFrame(game, {
      black: choices.black?.point ?? null,
      white: choices.white?.point ?? null,
    })
    const moves: FrameMoves = [choices.black?.point ?? null, choices.white?.point ?? null]
    const passed = (['black', 'white'] as const).filter((seat) => !choices[seat]?.point)
    if (next.phase === 'playing') {
      await this.ctx.storage.delete('choices')
      const deadline = await this.scheduleFrame(next, await this.frameSeconds())
      this.broadcast({ type: 'frame_settled', state: next, deadline, now: Date.now(), passed, moves })
    } else {
      await this.endGame(next, passed, moves)
    }
  }

  private async endGame(next: GameState, passed: Seat[] = [], moves?: FrameMoves): Promise<void> {
    // deadline 必须随终局清掉：残留的过期时点会被 armAlarm 当目标，闹钟立即重响进入风暴。
    await this.ctx.storage.delete(['choices', 'aiPlan', 'aiDrawOffered', 'aiDrawAsked', 'deadline'])
    await this.ctx.storage.setAlarm(Date.now() + IDLE_TTL_MS)
    await this.ctx.storage.put('game', next)
    this.broadcast({ type: 'frame_settled', state: next, deadline: null, now: Date.now(), passed, moves })
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
    // 匹配局对手是游客/隐身 AI 时也给注册棋手单边结算 ELO；邀请局对游客仍只记胜负。
    const matched = (await this.ctx.storage.get<boolean>('matched')) === true
    try {
      await this.env.ACCOUNTS.get(this.env.ACCOUNTS.idFromName('accounts')).recordResult(
        results,
        matched,
      )
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
