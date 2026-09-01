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
import { botRegistrations, dailyBots, parityBot, parseBotPool } from './bots'

const DAILY_HOUR_UTC = 12 // 20:00 北京时间（无夏令时，固定 UTC+8）
const ROUND_MS = 10 * 60_000
const FORFEIT_MS = 3 * 60_000 // 每轮开始后未进场判弃权的时限
const TFRAME = 15
const TMODE = 'forbidden'
const MIN_DRAW_MOVES = 30 // 和棋计分所需最少步数（game.frame）
const SKEW_MS = 1000
const DAY_MS = 86_400_000

type TState = 'idle' | 'active'
type Result = 'a' | 'b' | 'draw' | 'void' | 'bye' | null

interface Player {
  score: number
  opponents: string[]
  byes: number
}

export interface SwissPlayer {
  email: string
  score: number
  opponents: string[]
  byes: number
}

export interface Pairing {
  code: string | null
  players: [string, string | null] // [a, b]；b === null 表示轮空
  checkedIn: string[]
  result: Result
}

interface TournamentState {
  state: TState
  startedAt: number // 本届开赛时点：轮次网格锚点（第 N 轮名义起点 = startedAt + (N-1)*ROUND_MS）
  round: number
  totalRounds: number
  roundDeadline: number | null
  registrations: string[]
  players: Record<string, Player>
  bots: Record<string, Difficulty> // 本届陪打 bot 的邮箱 → 棋力
  pairings: Pairing[] // 当前轮
  past: Pairing[][] // 已结束的各轮
  lastStandings: Standing[]
  devStartsAt?: number // 仅 dev 注入：覆盖下一场开赛时点（正常恒为每天 20:00）
}

function defaultState(): TournamentState {
  return {
    state: 'idle',
    startedAt: 0,
    round: 0,
    totalRounds: 0,
    roundDeadline: null,
    registrations: [],
    players: {},
    bots: {},
    pairings: [],
    past: [],
    lastStandings: [],
  }
}

// 归档 key 用北京时间日期：20:00 开赛的「那一天」。
export function beijingDate(now: number): string {
  return new Date(now + 8 * 3600_000).toISOString().slice(0, 10)
}

export function nextDailyStart(now: number, hour = DAILY_HOUR_UTC): number {
  const d = new Date(now)
  const target = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hour, 0, 0, 0)
  return target > now ? target : target + DAY_MS
}

// 纯瑞士轮配对：按分数（并列随机）排序，优先未交手过的对手；奇数则将轮空判给
// 分数最低且未轮空过者。不做 FIDE/Dutch 最优匹配，允许在全交手过时退化为重复对手。
export function pairRound(players: SwissPlayer[], rng: () => number = Math.random): Pairing[] {
  const order = [...players].sort((a, b) => b.score - a.score || rng() - 0.5)
  const pairings: Pairing[] = []

  let pool = order
  if (pool.length % 2 === 1) {
    const bye = [...pool].reverse().find((p) => p.byes === 0) ?? pool[pool.length - 1]
    pairings.push({ code: null, players: [bye.email, null], checkedIn: [], result: 'bye' })
    pool = pool.filter((p) => p !== bye)
  }

  const paired = new Set<string>()
  for (let i = 0; i < pool.length; i++) {
    const a = pool[i]
    if (paired.has(a.email)) continue
    let partner = -1
    let fallback = -1
    for (let j = i + 1; j < pool.length; j++) {
      if (paired.has(pool[j].email)) continue
      if (fallback === -1) fallback = j
      if (!a.opponents.includes(pool[j].email)) {
        partner = j
        break
      }
    }
    const j = partner !== -1 ? partner : fallback
    if (j === -1) continue
    const b = pool[j]
    paired.add(a.email)
    paired.add(b.email)
    pairings.push({ code: null, players: [a.email, b.email], checkedIn: [], result: null })
  }
  return pairings
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
    const info = await this.ctx.blockConcurrencyWhile(async () => {
      const s = await this.load()
      await this.armIfNeeded(s)
      return this.toInfo(s, email)
    })
    try {
      pair[1].send(JSON.stringify(info))
    } catch {}
    return new Response(null, { status: 101, webSocket: pair[0] })
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

  async checkIn(input: { code: string; email: string }): Promise<void> {
    await this.ctx.blockConcurrencyWhile(async () => {
      const s = await this.load()
      const p = s.pairings.find((x) => x.code === input.code)
      if (p && !p.checkedIn.includes(input.email)) {
        p.checkedIn.push(input.email)
        await this.save(s)
        await this.broadcast(s)
      }
    })
  }

  async reportResult(input: {
    code: string
    round: number
    winnerEmail: string | null
    moves: number
  }): Promise<void> {
    await this.ctx.blockConcurrencyWhile(async () => {
      const s = await this.load()
      if (s.state !== 'active' || input.round !== s.round) return
      const p = s.pairings.find((x) => x.code === input.code)
      if (!p || p.result !== null) return
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
      if (s.pairings.every((x) => x.result !== null)) await this.advance(s)
      await this.save(s)
      await this.broadcast(s)
    })
  }

  async alarm(): Promise<void> {
    await this.ctx.blockConcurrencyWhile(async () => {
      const s = await this.load()
      if (s.state !== 'active') await this.start(s)
      else if (s.roundDeadline !== null && Date.now() < s.roundDeadline - SKEW_MS) {
        await this.forfeitCheckpoint(s)
      } else {
        await this.closeRound(s)
      }
      await this.save(s)
      await this.broadcast(s)
    })
  }

  private async start(s: TournamentState): Promise<void> {
    if (s.state !== 'idle') return
    s.devStartsAt = undefined
    const emails = [...s.registrations]
    s.bots = {}
    const pool = this.botPool()
    if (pool.length) {
      // 凑成偶数免得轮空送运气分。
      const dateKey = beijingDate(Date.now())
      const bots = dailyBots(dateKey, pool)
      if ((emails.length + bots.length) % 2 === 1) {
        const filler = parityBot(dateKey, pool)
        if (filler) bots.push(filler)
      }
      for (const bot of bots) {
        if (emails.includes(bot.email)) continue
        emails.push(bot.email)
        s.bots[bot.email] = bot.difficulty
      }
    }
    if (emails.length < 2) {
      await this.ctx.storage.setAlarm(nextDailyStart(Date.now()))
      return
    }
    s.players = {}
    for (const email of emails) s.players[email] = { score: 0, opponents: [], byes: 0 }
    s.registrations = []
    s.past = []
    s.startedAt = Date.now()
    s.round = 1
    s.totalRounds = Math.max(1, Math.ceil(Math.log2(Object.keys(s.players).length)))
    s.state = 'active'
    await this.pairAndAlloc(s)
  }

  // 开轮 3 分钟检查点：没进场的判弃权（对手在场即轮空胜、双方都缺席作废），已开打的照常。
  private async forfeitCheckpoint(s: TournamentState): Promise<void> {
    const forfeitAt = s.roundDeadline! - ROUND_MS + FORFEIT_MS
    if (Date.now() < forfeitAt - SKEW_MS) {
      // 被 advance 抢先换了新一轮，本次 alarm 已过期，重挂即可。
      await this.ctx.storage.setAlarm(Math.min(forfeitAt, s.roundDeadline!))
      return
    }
    for (const p of s.pairings) {
      if (p.result !== null || p.checkedIn.length >= 2) continue
      p.result = p.checkedIn.length === 0 ? 'void' : p.checkedIn[0] === p.players[0] ? 'a' : 'b'
      this.applyResult(s, p)
    }
    if (s.pairings.every((p) => p.result !== null)) await this.advance(s)
    else await this.ctx.storage.setAlarm(s.roundDeadline!)
  }

  private async closeRound(s: TournamentState): Promise<void> {
    if (s.state !== 'active') return
    for (const p of s.pairings) {
      if (p.result !== null) continue
      const present = (p.players.filter((e) => e !== null) as string[]).filter((e) =>
        p.checkedIn.includes(e),
      )
      // 双方都在场却没下完 → 轮时到判平；仅一方到场轮空胜；都没来作废。
      if (present.length === 2) p.result = 'draw'
      else if (present.length === 1) p.result = present[0] === p.players[0] ? 'a' : 'b'
      else p.result = 'void'
      this.applyResult(s, p)
    }
    await this.advance(s)
  }

  private async advance(s: TournamentState): Promise<void> {
    s.past.push(s.pairings) // 归档刚结束的一轮
    if (s.round < s.totalRounds) {
      s.round += 1
      await this.pairAndAlloc(s)
    } else {
      s.lastStandings = this.standings(s)
      // 每天的终榜按日期永久归档（原始邮箱，展示时再按开关脱敏）；lastStandings 仅是最近一届的展示缓存。
      await this.ctx.storage.put(`standings:${beijingDate(Date.now())}`, s.lastStandings)
      s.state = 'idle'
      s.round = 0
      s.totalRounds = 0
      s.roundDeadline = null
      s.players = {}
      s.bots = {}
      s.pairings = []
      await this.ctx.storage.setAlarm(nextDailyStart(Date.now()))
    }
  }

  private async pairAndAlloc(s: TournamentState): Promise<void> {
    const roster: SwissPlayer[] = Object.entries(s.players).map(([email, p]) => ({ email, ...p }))
    const pairings = pairRound(roster)
    for (const p of pairings) {
      if (p.players[1]) {
        s.players[p.players[0]].opponents.push(p.players[1])
        s.players[p.players[1]].opponents.push(p.players[0])
      }
      if (p.result === 'bye') {
        this.applyResult(s, p)
      } else {
        try {
          p.code = await allocateRoom(this.env, TFRAME, TMODE, {
            tournament: {
              round: s.round,
              players: [p.players[0], p.players[1]!],
              bots: [s.bots[p.players[0]] ?? null, s.bots[p.players[1]!] ?? null],
            },
          })
        } catch {
          p.result = 'void' // 建房失败则该局作废
        }
      }
    }
    s.pairings = pairings
    // 轮次挂在固定网格上：上一轮提前收轮只是让本轮提前可下，弃权点（名义开轮+3min）
    // 与截止（名义开轮+10min）不前移，即固定在 20:03/20:13/… 与 20:10/20:20/…。
    s.roundDeadline = s.startedAt + s.round * ROUND_MS
    // 先在弃权检查点醒来，届时再把闹钟拨到本轮截止。
    await this.ctx.storage.setAlarm(s.roundDeadline - ROUND_MS + FORFEIT_MS)
  }

  private applyResult(s: TournamentState, p: Pairing): void {
    const a = s.players[p.players[0]]
    if (!a) return
    if (p.result === 'bye') {
      a.score += 1
      a.byes += 1
      return
    }
    const b = p.players[1] ? s.players[p.players[1]] : null
    if (!b) return
    if (p.result === 'draw') {
      a.score += 0.5
      b.score += 0.5
    } else if (p.result === 'a') {
      a.score += 1
    } else if (p.result === 'b') {
      b.score += 1
    }
    // void → 双方 0 分
  }

  // 榜内保留原始邮箱，展示时统一经 displayEmails 按账号开关打码。
  private standings(s: TournamentState): Standing[] {
    const buchholz = (p: Player) =>
      p.opponents.reduce((sum, o) => sum + (s.players[o]?.score ?? 0), 0)
    return Object.entries(s.players)
      .map(([email, p]) => ({
        email,
        score: p.score,
        played: p.opponents.length + p.byes,
        buchholz: buchholz(p),
      }))
      .sort((a, b) => b.score - a.score || b.buchholz - a.buchholz || a.email.localeCompare(b.email))
      .map(({ email, score, played }) => ({ email, score, played }))
  }

  // 按本轮配对推断每人状态：未出结果时到场即对局中、未到场为待开始；
  // 已出结果时到过场的算已结束（轮空视同），整轮没露面的视为已离开。
  private playerStatuses(s: TournamentState): Map<string, PlayerStatus> {
    const statuses = new Map<string, PlayerStatus>()
    for (const p of s.pairings) {
      for (const email of p.players) {
        if (email === null) continue
        const arrived = p.checkedIn.includes(email)
        statuses.set(
          email,
          p.result === null
            ? arrived
              ? 'playing'
              : 'pending'
            : p.result === 'bye' || arrived
              ? 'done'
              : 'left',
        )
      }
    }
    return statuses
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
    const statuses = s.state === 'active' ? this.playerStatuses(s) : null
    // 观战门槛：本轮自己的状态为「已结束」（到场打完或轮空）才开放各桌对阵；
    // 未打完、缺席判离开的都不行。
    const myDone = participating && statuses?.get(email!) === 'done'
    const showLive = s.state !== 'active' || myDone
    const myGame = participating
      ? (s.pairings.find((x) => x.code && x.result === null && x.players.includes(email!))?.code ??
          null)
      : null
    const liveRounds = s.state === 'active' ? [...s.past, s.pairings] : s.past
    // 实时榜全员可见；进行中的逐轮配对仅参赛者可见（防多号观战对方局面）。
    const standings = s.state === 'idle' ? s.lastStandings : this.standings(s)
    const rounds = showLive ? liveRounds.map((r) => r.map((p) => this.toMatch(p))) : []
    const names = await this.displayNames([
      ...new Set([
        ...standings.map((row) => row.email),
        ...rounds.flat().flatMap((m) => (m.b ? [m.a, m.b] : [m.a])),
      ]),
    ])
    const shown = (raw: string) => names.get(raw) ?? maskEmail(raw)
    // 脱敏后邮箱可能撞车，「我」的位置以脱敏前的下标为准下发。
    const meIndex = email === null ? -1 : standings.findIndex((row) => row.email === email)
    const startsAt = (s.state === 'idle' && s.devStartsAt) || nextDailyStart(now)
    // 报名注水：开赛前的报名人数惰性叠加当日 bot 时间表里已「报名」的数量。
    const pool = this.botPool()
    const virtualCount = pool.length
      ? botRegistrations(beijingDate(startsAt), pool, startsAt, now).length
      : 0
    return {
      state: s.state,
      now,
      startsAt,
      round: s.round,
      totalRounds: s.totalRounds,
      playerCount:
        s.state === 'idle'
          ? s.registrations.length + virtualCount
          : Object.keys(s.players).length,
      registered,
      participating,
      myGame: myGame ? { code: myGame } : null,
      roundDeadline: s.roundDeadline,
      standings: standings.map((row) => ({
        ...row,
        email: shown(row.email),
        ...(statuses && { status: statuses.get(row.email) ?? 'pending' }),
      })),
      me: meIndex < 0 ? null : meIndex,
      rounds: rounds.map((r) => r.map((m) => ({ ...m, a: shown(m.a), b: m.b && shown(m.b) }))),
    }
  }

  private toMatch(p: Pairing): Match {
    return {
      code: p.code,
      a: p.players[0],
      b: p.players[1],
      status: p.result !== null ? 'done' : p.checkedIn.length >= 2 ? 'playing' : 'pending',
      result: p.result,
    }
  }

  // 观战资格（Room 校验用）：本轮参赛且自己的状态为「已结束」（缺席判离开的不算）。
  async canSpectate(email: string): Promise<boolean> {
    return this.ctx.blockConcurrencyWhile(async () => {
      const s = await this.load()
      return (
        s.state === 'active' &&
        email in s.players &&
        this.playerStatuses(s).get(email) === 'done'
      )
    })
  }

  // 本地开发数据注入（路由仅 localhost 暴露，见 index.ts）：覆写状态、重挂闹钟并广播。
  async devSeed(input: Partial<TournamentState>): Promise<void> {
    await this.ctx.blockConcurrencyWhile(async () => {
      const s = { ...(await this.load()), ...input }
      s.devStartsAt = input.devStartsAt // 不从上一次注入残留
      if (s.state === 'active') {
        s.roundDeadline = Date.now() + ROUND_MS
        s.startedAt = s.roundDeadline - s.round * ROUND_MS
        await this.ctx.storage.setAlarm(Date.now() + FORFEIT_MS)
      } else {
        s.roundDeadline = null
        await this.ctx.storage.setAlarm(s.devStartsAt ?? nextDailyStart(Date.now()))
      }
      await this.save(s)
      await this.broadcast(s)
    })
  }

  private async armIfNeeded(s: TournamentState): Promise<void> {
    if (s.state === 'idle' && (await this.ctx.storage.getAlarm()) === null) {
      await this.ctx.storage.setAlarm(s.devStartsAt ?? nextDailyStart(Date.now()))
    }
  }

  private botPool(): string[] {
    return parseBotPool(this.env.TOURNAMENT_BOTS)
  }

  private async load(): Promise<TournamentState> {
    const s = (await this.ctx.storage.get<TournamentState>('t')) ?? defaultState()
    s.past ??= []
    s.bots ??= {}
    // 旧状态没有网格锚点时按当前轮的截止反推，保证进行中的一届无缝续跑。
    s.startedAt ??= (s.roundDeadline ?? Date.now()) - s.round * ROUND_MS
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
