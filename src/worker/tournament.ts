import { DurableObject } from 'cloudflare:workers'
import type { Difficulty } from '@gomoku/engine/ai'
import {
  maskEmail,
  type Match,
  type PlayerStatus,
  type Standing,
  type TournamentInfo,
} from '@/shared/protocol'
import { allocateRoom } from './roomCode'
import {
  botRegistrations,
  dailyBots,
  gameDifficulty,
  pairedBotDifficulties,
  parseBotPool,
} from './bots'

// 每日赛程缺省值：20:00 开赛（北京时间，无夏令时，固定 UTC+8）、30 分钟竞技场窗口。
// 窗口内配新对局；已开局的照常打完，超过窗口收官也计分。可用 TOURNAMENT_WINDOW 覆盖。
const DEFAULT_START_MIN = 20 * 60
const ARENA_MS = 30 * 60_000
// 一局打完后的冷却：赢家歇得更久（防连胜连刷），未打成（void）不冷却。
const COOLDOWN_LOSS_MS = 15_000
const COOLDOWN_DRAW_MS = 30_000
const COOLDOWN_WIN_MS = 45_000
const PAIR_TTL_MS = 2 * 60_000 // 配上后迟迟未开局的裁决时限
const WRAPUP_MS = 20 * 60_000 // 窗口关闭后仍未决对局（房间悄悄死掉等）的硬兜底
const POLL_MS = 60_000
const TFRAME = 15
const TMODE = 'forbidden'
const MIN_DRAW_MOVES = 30 // 和棋计分所需最少步数（game.frame）
const SKEW_MS = 1000
const DAY_MS = 86_400_000

type TState = 'idle' | 'active'
type Result = 'a' | 'b' | 'draw' | 'void' | null

interface Player {
  score: number
  wins: number
  games: number
  opponents: string[]
}

export interface Pairing {
  code: string
  players: [string, string]
  checkedIn: string[]
  started?: true // 房间已实际开局（双方就绪）；入座只算 checkedIn
  result: Result
  createdAt: number
}

interface TournamentState {
  state: TState
  startedAt: number
  registrations: string[]
  players: Record<string, Player>
  bots: Record<string, Difficulty> // 本届陪打 bot 的邮箱 → 基准棋力档（每局在 ±1 档内浮动）
  queue: string[] // 匹配中（先到先配）
  cooldowns: Record<string, number> // email → 冷却结束时点
  botSeekAt: Record<string, number> // bot → 下次「点匹配」的时点
  pairings: Pairing[]
  lastStandings: Standing[]
}

function defaultState(): TournamentState {
  return {
    state: 'idle',
    startedAt: 0,
    registrations: [],
    players: {},
    bots: {},
    queue: [],
    cooldowns: {},
    botSeekAt: {},
    pairings: [],
    lastStandings: [],
  }
}

// 归档 key 用北京时间日期：20:00 开赛的「那一天」。
export function beijingDate(now: number): string {
  return new Date(now + 8 * 3600_000).toISOString().slice(0, 10)
}

// TOURNAMENT_WINDOW 环境变量：「HH:MM-HH:MM」北京时间，开赛时点与竞技场关闭时点。
// 支持跨零点（如 23:50-00:20）；缺省或非法回落到 20:00 开赛、30 分钟窗口。
export function tournamentWindow(value?: string): { startMin: number; arenaMs: number } {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)-([01]?\d|2[0-3]):([0-5]\d)$/.exec(value ?? '')
  if (m) {
    const start = Number(m[1]) * 60 + Number(m[2])
    const minutes = (Number(m[3]) * 60 + Number(m[4]) - start + 1440) % 1440
    if (minutes > 0) return { startMin: start, arenaMs: minutes * 60_000 }
  }
  return { startMin: DEFAULT_START_MIN, arenaMs: ARENA_MS }
}

export function nextDailyStart(now: number, window?: string): number {
  const { startMin } = tournamentWindow(window)
  const d = new Date(now)
  let target = Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate(),
    Math.floor(startMin / 60) - 8,
    startMin % 60,
  )
  while (target <= now) target += DAY_MS
  return target
}

interface SocketTag {
  email: string | null
}

export class Tournament extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'))
  }

  // 大厅/弹窗不轮询，改走 WebSocket：连上即推一帧，此后每次状态变化按连接者身份各推一帧。
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 })
    }
    const token = new URL(request.url).searchParams.get('token')
    const email = token ? await this.email(token) : null
    const pair = new WebSocketPair()
    this.ctx.acceptWebSocket(pair[1])
    pair[1].serializeAttachment({ email } satisfies SocketTag)
    await this.ctx.blockConcurrencyWhile(async () => {
      const s = await this.load()
      await this.armIfNeeded(s)
      // 参赛者（重）上线可能把自己从「已离开」变回在场：一次 broadcast 覆盖本人与其他人；
      // 其余情形（游客/赛前）只给新连接推一帧即可。
      if (s.state === 'active' && email !== null && email in s.players) {
        await this.broadcast(s)
      } else {
        try {
          pair[1].send(JSON.stringify(await this.toInfo(s, email)))
        } catch {}
      }
    })
    return new Response(null, { status: 101, webSocket: pair[0] })
  }

  // 大厅连接断开：参赛者可能变「已离开」，重算在场状态推给其余连接。
  async webSocketClose(): Promise<void> {
    await this.ctx.blockConcurrencyWhile(async () => {
      const s = await this.load()
      if (s.state === 'active') await this.broadcast(s)
    })
  }

  private async broadcast(s: TournamentState): Promise<void> {
    const sockets = this.ctx.getWebSockets()
    if (sockets.length === 0) return
    // 内容按身份个性化（registered/myGame/me），相同身份共享一次序列化。
    const payloads = new Map<string | null, string>()
    for (const ws of sockets) {
      const { email } = ws.deserializeAttachment() as SocketTag
      let payload = payloads.get(email)
      if (payload === undefined) {
        payload = JSON.stringify(await this.toInfo(s, email))
        payloads.set(email, payload)
      }
      try {
        ws.send(payload)
      } catch {}
    }
  }

  async getInfo(token: string | null): Promise<TournamentInfo> {
    return this.ctx.blockConcurrencyWhile(async () => {
      const email = token ? await this.email(token) : null
      const s = await this.load()
      await this.armIfNeeded(s)
      return this.toInfo(s, email)
    })
  }

  async register(token: string): Promise<TournamentInfo> {
    return this.ctx.blockConcurrencyWhile(async () => {
      const email = await this.email(token)
      const s = await this.load()
      // 进行中也可报名，报的是下一场（累积到 registrations，下次 start 消费）。
      if (email && !s.registrations.includes(email)) {
        s.registrations.push(email)
        await this.save(s)
        await this.broadcast(s)
      }
      await this.armIfNeeded(s)
      return this.toInfo(s, email)
    })
  }

  async withdraw(token: string): Promise<TournamentInfo> {
    return this.ctx.blockConcurrencyWhile(async () => {
      const email = await this.email(token)
      const s = await this.load()
      if (email && s.registrations.includes(email)) {
        s.registrations = s.registrations.filter((e) => e !== email)
        await this.save(s)
        await this.broadcast(s)
      }
      return this.toInfo(s, email)
    })
  }

  // 「匹配对手」：第一局与冷却结束后都由玩家手动触发，绝不自动排队。
  async seekMatch(token: string): Promise<TournamentInfo> {
    return this.ctx.blockConcurrencyWhile(async () => {
      const email = await this.email(token)
      const s = await this.load()
      const now = Date.now()
      if (
        email !== null &&
        s.state === 'active' &&
        email in s.players &&
        now < this.matchCloseAt(s) &&
        !s.queue.includes(email) &&
        (s.cooldowns[email] ?? 0) <= now &&
        !this.unresolvedOf(s, email)
      ) {
        s.queue.push(email)
        await this.tryPair(s)
        await this.armActive(s)
        await this.save(s)
        await this.broadcast(s)
      }
      return this.toInfo(s, email)
    })
  }

  async cancelSeek(token: string): Promise<TournamentInfo> {
    return this.ctx.blockConcurrencyWhile(async () => {
      const email = await this.email(token)
      const s = await this.load()
      // 已被配走（不在队列）就当无事发生，随后的 myGame 推送会把玩家带进房。
      if (email !== null && s.queue.includes(email)) {
        s.queue = s.queue.filter((e) => e !== email)
        await this.save(s)
        await this.broadcast(s)
      }
      return this.toInfo(s, email)
    })
  }

  async checkIn(input: { code: string; email: string }): Promise<void> {
    await this.ctx.blockConcurrencyWhile(async () => {
      const s = await this.load()
      const p = s.pairings.find((x) => x.code === input.code && x.result === null)
      if (p && !p.checkedIn.includes(input.email)) {
        p.checkedIn.push(input.email)
        await this.save(s)
        await this.broadcast(s)
      }
    })
  }

  async gameStarted(input: { code: string }): Promise<void> {
    await this.ctx.blockConcurrencyWhile(async () => {
      const s = await this.load()
      const p = s.pairings.find((x) => x.code === input.code && x.result === null)
      if (p && !p.started) {
        p.started = true
        await this.save(s)
        await this.broadcast(s)
      }
    })
  }

  async reportResult(input: {
    code: string
    winnerEmail: string | null
    moves: number
  }): Promise<void> {
    await this.ctx.blockConcurrencyWhile(async () => {
      const s = await this.load()
      if (s.state !== 'active') return
      // 只认未决对局：窗口关闭后收官的迟到结果照样有效，重复上报被幂等挡掉。
      const p = s.pairings.find((x) => x.code === input.code && x.result === null)
      if (!p) return
      if (input.winnerEmail === null) {
        p.result = input.moves >= MIN_DRAW_MOVES ? 'draw' : 'void'
      } else if (input.winnerEmail === p.players[0]) {
        p.result = 'a'
      } else if (input.winnerEmail === p.players[1]) {
        p.result = 'b'
      } else {
        return // 上报者不属于本对；忽略
      }
      this.applyResult(s, p)
      this.afterResult(s, p)
      if (!(await this.maybeFinish(s))) await this.armActive(s)
      await this.save(s)
      await this.broadcast(s)
    })
  }

  async alarm(): Promise<void> {
    await this.ctx.blockConcurrencyWhile(async () => {
      const s = await this.load()
      if (s.state !== 'active') await this.start(s)
      else await this.tick(s)
      await this.save(s)
      await this.broadcast(s)
    })
  }

  private async start(s: TournamentState): Promise<void> {
    if (s.state !== 'idle') return
    const emails = [...s.registrations]
    s.bots = {}
    const pool = this.botPool()
    if (pool.length) {
      const bots = dailyBots(beijingDate(Date.now()), pool, this.prevRankedBots(s, pool))
      for (const bot of bots) {
        if (emails.includes(bot.email)) continue
        emails.push(bot.email)
        s.bots[bot.email] = bot.difficulty
      }
    }
    if (emails.length < 2) {
      await this.ctx.storage.setAlarm(this.nextStart())
      return
    }
    s.players = {}
    for (const email of emails) s.players[email] = { score: 0, wins: 0, games: 0, opponents: [] }
    s.registrations = []
    s.pairings = []
    s.queue = []
    s.cooldowns = {}
    s.botSeekAt = {}
    s.startedAt = Date.now()
    s.state = 'active'
    // 竞技场没有整点发牌：bot 也和真人一样过一会儿才「点匹配」，首局错峰进场。
    for (const email of Object.keys(s.bots)) {
      s.botSeekAt[email] = s.startedAt + 5_000 + Math.random() * 40_000
    }
    await this.armActive(s)
  }

  private async tick(s: TournamentState): Promise<void> {
    const now = Date.now()
    const close = this.matchCloseAt(s)
    for (const email of Object.keys(s.cooldowns)) {
      if (s.cooldowns[email] <= now + SKEW_MS) delete s.cooldowns[email]
    }
    for (const email of Object.keys(s.botSeekAt)) {
      if (now < s.botSeekAt[email] - SKEW_MS) continue
      delete s.botSeekAt[email]
      if (now >= close) continue
      if (
        email in s.players &&
        !s.queue.includes(email) &&
        (s.cooldowns[email] ?? 0) <= now + SKEW_MS &&
        !this.unresolvedOf(s, email)
      ) {
        s.queue.push(email)
      }
    }
    if (now >= close) s.queue = [] // 窗口关闭：停配新对局，等待中的回到空闲
    await this.tryPair(s)
    this.resolveStalled(s, now)
    if (now >= close + WRAPUP_MS - SKEW_MS) this.wrapup(s)
    if (!(await this.maybeFinish(s))) await this.armActive(s)
  }

  private async tryPair(s: TournamentState): Promise<void> {
    while (s.queue.length >= 2) {
      const a = s.queue[0]
      // 候选里选交手次数最少的对手（并列随机），少重复对阵。
      const met = new Map<string, number>()
      for (const o of s.players[a]?.opponents ?? []) met.set(o, (met.get(o) ?? 0) + 1)
      let best: string[] = []
      let bestMet = Infinity
      for (const cand of s.queue.slice(1)) {
        const m = met.get(cand) ?? 0
        if (m < bestMet) {
          bestMet = m
          best = [cand]
        } else if (m === bestMet) {
          best.push(cand)
        }
      }
      const b = best[Math.floor(Math.random() * best.length)]
      s.queue = s.queue.filter((e) => e !== a && e !== b)
      const baseA = s.bots[a] ?? null
      const baseB = s.bots[b] ?? null
      // 双 bot 强制异档：同档互搏极易和棋。
      const bots: [Difficulty | null, Difficulty | null] =
        baseA && baseB
          ? pairedBotDifficulties(baseA, baseB)
          : [baseA && gameDifficulty(baseA), baseB && gameDifficulty(baseB)]
      try {
        const code = await allocateRoom(this.env, TFRAME, TMODE, {
          tournament: { players: [a, b], bots },
        })
        s.pairings.push({ code, players: [a, b], checkedIn: [], result: null, createdAt: Date.now() })
        s.players[a].opponents.push(b)
        s.players[b].opponents.push(a)
      } catch {
        // 建房失败：双方回到空闲，可重新点匹配
      }
    }
  }

  // 配上却迟迟没开局的对局：到时限后按到场情况裁决（到场方胜/双缺作废）；
  // 双方都到场或已开局的不动，交给对局自身或收尾兜底。
  private resolveStalled(s: TournamentState, now: number): void {
    for (const p of s.pairings) {
      if (p.result !== null || p.started || p.checkedIn.length >= 2) continue
      if (now < p.createdAt + PAIR_TTL_MS - SKEW_MS) continue
      p.result = p.checkedIn.length === 0 ? 'void' : p.checkedIn[0] === p.players[0] ? 'a' : 'b'
      this.applyResult(s, p)
      this.afterResult(s, p)
    }
  }

  // 窗口关闭很久仍未决的僵尸对局（房间悄悄死掉等）：双方到场的判平，其余作废。
  private wrapup(s: TournamentState): void {
    for (const p of s.pairings) {
      if (p.result !== null) continue
      p.result = p.started && p.checkedIn.length === 2 ? 'draw' : 'void'
      this.applyResult(s, p)
      this.afterResult(s, p)
    }
  }

  private applyResult(s: TournamentState, p: Pairing): void {
    const [a, b] = p.players.map((e) => s.players[e])
    if (!a || !b) return
    a.games += 1
    b.games += 1
    if (p.result === 'draw') {
      a.score += 0.5
      b.score += 0.5
    } else if (p.result === 'a') {
      a.score += 1
      a.wins += 1
    } else if (p.result === 'b') {
      b.score += 1
      b.wins += 1
    }
    // void → 双方 0 分
  }

  // 一局打完先冷却（期内可观战），结束后要自己再点匹配；bot 在冷却后隔一小段随机时间「点」。
  private afterResult(s: TournamentState, p: Pairing): void {
    const now = Date.now()
    p.players.forEach((email, i) => {
      if (!(email in s.players)) return
      const cooldown =
        p.result === 'draw'
          ? COOLDOWN_DRAW_MS
          : p.result === (i === 0 ? 'a' : 'b')
            ? COOLDOWN_WIN_MS
            : p.result === 'void'
              ? 0
              : COOLDOWN_LOSS_MS
      if (cooldown > 0) s.cooldowns[email] = now + cooldown
      if (email in s.bots && now + cooldown < this.matchCloseAt(s)) {
        s.botSeekAt[email] = now + cooldown + 3_000 + Math.random() * 27_000
      }
    })
  }

  // 窗口已关且所有对局尘埃落定才收官出榜——最后一局拖过窗口也照常计分。
  private async maybeFinish(s: TournamentState): Promise<boolean> {
    if (Date.now() < this.matchCloseAt(s) - SKEW_MS) return false
    if (s.pairings.some((p) => p.result === null)) return false
    await this.finish(s)
    return true
  }

  private async finish(s: TournamentState): Promise<void> {
    s.lastStandings = this.standings(s)
    // 每天的终榜按日期永久归档（原始邮箱，展示时再按开关脱敏）；lastStandings 仅是最近一届的展示缓存。
    await this.ctx.storage.put(`standings:${beijingDate(Date.now())}`, s.lastStandings)
    s.state = 'idle'
    s.players = {}
    s.bots = {}
    s.queue = []
    s.cooldowns = {}
    s.botSeekAt = {}
    s.pairings = []
    await this.ctx.storage.setAlarm(this.nextStart())
  }

  private async armActive(s: TournamentState): Promise<void> {
    const now = Date.now()
    const close = this.matchCloseAt(s)
    const targets = Object.values(s.botSeekAt)
    // 冷却到期也是闹钟目标：到点广播一帧，榜单上的「冷却中」标记即时翻回。
    targets.push(...Object.values(s.cooldowns).filter((t) => t > now))
    for (const p of s.pairings) {
      if (p.result === null && !p.started && p.checkedIn.length < 2) {
        targets.push(p.createdAt + PAIR_TTL_MS)
      }
    }
    if (now < close) targets.push(close)
    else if (s.pairings.some((p) => p.result === null)) {
      targets.push(Math.min(now + POLL_MS, close + WRAPUP_MS))
    }
    // 已到期目标钳到严格未来：线上把设在过去的闹钟归并到平台约 60s 一轮的补扫（见 Room.armAlarm）。
    if (targets.length) {
      await this.ctx.storage.setAlarm(Math.max(Math.min(...targets), now + 100))
    }
  }

  private matchCloseAt(s: TournamentState): number {
    return s.startedAt + tournamentWindow(this.env.TOURNAMENT_WINDOW).arenaMs
  }

  private unresolvedOf(s: TournamentState, email: string): Pairing | undefined {
    return s.pairings.find((p) => p.result === null && p.players.includes(email))
  }

  // 当前连着大厅 WebSocket 的账号（游客 email 为 null，不计）。bot 无连接，靠 s.bots 豁免。
  private connectedEmails(): Set<string> {
    const set = new Set<string>()
    for (const ws of this.ctx.getWebSockets()) {
      const { email } = ws.deserializeAttachment() as SocketTag
      if (email) set.add(email)
    }
    return set
  }

  private statuses(s: TournamentState, viewer: string | null): Map<string, PlayerStatus> {
    const now = Date.now()
    const connected = this.connectedEmails()
    if (viewer) connected.add(viewer) // 请求者本人必然在场，不会把自己看成「已离开」
    const map = new Map<string, PlayerStatus>()
    for (const email of Object.keys(s.players)) {
      const pairing = this.unresolvedOf(s, email)
      // 对局中/待进房的席位由 pairing 判定（此时真人已离开大厅去房间，不算「已离开」）；
      // 刚打完的先显示冷却（人常还停在房间页、没连大厅）；其余空闲席位里，真人断开了
      // 大厅连接即「已离开」，bot 永远视为在场。
      map.set(
        email,
        pairing
          ? pairing.started
            ? 'playing'
            : 'readying'
          : s.queue.includes(email)
            ? 'matching'
            : (s.cooldowns[email] ?? 0) > now
              ? 'cooldown'
              : email in s.bots || connected.has(email)
                ? 'idle'
                : 'left',
      )
    }
    return map
  }

  // 榜内保留原始邮箱，展示时统一经 displayEmails 按账号开关打码。
  private standings(s: TournamentState): Standing[] {
    return Object.entries(s.players)
      .map(([email, p]) => ({ email, score: p.score, played: p.games, wins: p.wins }))
      .sort((a, b) => b.score - a.score || b.wins - a.wins || a.email.localeCompare(b.email))
      .map(({ email, score, played }) => ({ email, score, played }))
  }

  private async displayNames(emails: string[]): Promise<Map<string, string>> {
    try {
      const display = await this.env.ACCOUNTS.get(
        this.env.ACCOUNTS.idFromName('accounts'),
      ).displayEmails(emails)
      return new Map(emails.map((email, i) => [email, display[i] ?? maskEmail(email)]))
    } catch {
      return new Map(emails.map((email) => [email, maskEmail(email)]))
    }
  }

  private async toInfo(s: TournamentState, email: string | null): Promise<TournamentInfo> {
    const now = Date.now()
    const participating = s.state === 'active' && email !== null && email in s.players
    const registered = email !== null && s.registrations.includes(email)
    const statuses = s.state === 'active' ? this.statuses(s, email) : null
    const myPairing = participating ? this.unresolvedOf(s, email!) : undefined
    // 观战不设门槛：进行中的桌对所有人（含游客）下发房号；帧内选点本就要结算后才可见。
    const games = [...s.pairings].reverse().map((p) => this.toMatch(p, s.state === 'active'))
    const standings = s.state === 'idle' ? s.lastStandings : this.standings(s)
    const names = await this.displayNames([
      ...new Set([
        ...standings.map((row) => row.email),
        ...games.flatMap((m) => [m.a, m.b]),
      ]),
    ])
    const shown = (raw: string) => names.get(raw) ?? maskEmail(raw)
    // 脱敏后邮箱可能撞车，「我」的位置以脱敏前的下标为准下发。
    const meIndex = email === null ? -1 : standings.findIndex((row) => row.email === email)
    const startsAt = this.nextStart(now)
    // 报名注水：开赛前的报名人数惰性叠加当日 bot 时间表里已「报名」的数量。
    const pool = this.botPool()
    const virtualCount = pool.length
      ? botRegistrations(beijingDate(startsAt), pool, startsAt, now, this.prevRankedBots(s, pool))
          .length
      : 0
    return {
      state: s.state,
      now,
      startsAt,
      playerCount:
        s.state === 'idle'
          ? s.registrations.length + virtualCount
          : Object.keys(s.players).length,
      registered,
      participating,
      myGame: myPairing ? { code: myPairing.code } : null,
      matchCloseAt: s.state === 'active' ? this.matchCloseAt(s) : null,
      arenaMinutes: Math.round(tournamentWindow(this.env.TOURNAMENT_WINDOW).arenaMs / 60_000),
      my: participating
        ? {
            status: statuses!.get(email!) ?? 'idle',
            cooldownUntil: (s.cooldowns[email!] ?? 0) > now ? s.cooldowns[email!] : null,
          }
        : null,
      standings: standings.map((row) => ({
        ...row,
        email: shown(row.email),
        ...(statuses && { status: statuses.get(row.email) ?? 'idle' }),
      })),
      me: meIndex < 0 ? null : meIndex,
      games: games.map((m) => ({ ...m, a: shown(m.a), b: shown(m.b) })),
    }
  }

  private toMatch(p: Pairing, includeCode: boolean): Match {
    return {
      code: includeCode && p.result === null ? p.code : null,
      a: p.players[0],
      b: p.players[1],
      status: p.result !== null ? 'done' : p.started ? 'playing' : 'readying',
      result: p.result,
    }
  }

  // 空闲态闹钟始终对齐下一场开赛点：TOURNAMENT_WINDOW 变更后旧闹钟不作数。
  private async armIfNeeded(s: TournamentState): Promise<void> {
    if (s.state !== 'idle') return
    const armed = await this.ctx.storage.getAlarm()
    if (armed !== null && armed <= Date.now()) return // 已到点、等待触发中，别把它臂到明天
    const want = this.nextStart()
    if (armed !== want) await this.ctx.storage.setAlarm(want)
  }

  private botPool(): string[] {
    return parseBotPool(this.env.TOURNAMENT_BOTS)
  }

  private nextStart(now = Date.now()): number {
    return nextDailyStart(now, this.env.TOURNAMENT_WINDOW)
  }

  // 上一届 bot 按名次排列（榜单 ∩ 池），供阵容逐日演化：池启用后每天必开赛，
  // 上一届终榜必含当届全部 bot，无需另存阵容。
  private prevRankedBots(s: TournamentState, pool: string[]): string[] {
    return s.lastStandings.map((row) => row.email).filter((e) => pool.includes(e))
  }

  private async load(): Promise<TournamentState> {
    const s = (await this.ctx.storage.get<TournamentState>('t')) ?? defaultState()
    s.bots ??= {}
    s.cooldowns ??= {}
    s.queue ??= []
    s.botSeekAt ??= {}
    s.pairings ??= []
    return s
  }

  private save(s: TournamentState): Promise<void> {
    return this.ctx.storage.put('t', s)
  }

  private async email(token: string): Promise<string | null> {
    try {
      const profile = await this.env.ACCOUNTS.get(this.env.ACCOUNTS.idFromName('accounts')).me(token)
      return profile?.email ?? null
    } catch {
      return null
    }
  }
}
