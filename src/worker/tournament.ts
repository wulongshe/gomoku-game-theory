import { DurableObject } from 'cloudflare:workers'
import { maskEmail, type Match, type Standing, type TournamentInfo } from '@/shared/protocol'
import { allocateRoom } from './roomCode'

const DAILY_HOUR_UTC = 12 // 20:00 北京时间（无夏令时，固定 UTC+8）
const ROUND_MS = 10 * 60_000
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
  round: number
  totalRounds: number
  roundDeadline: number | null
  registrations: string[]
  players: Record<string, Player>
  pairings: Pairing[] // 当前轮
  past: Pairing[][] // 已结束的各轮
  lastStandings: Standing[]
}

function defaultState(): TournamentState {
  return {
    state: 'idle',
    round: 0,
    totalRounds: 0,
    roundDeadline: null,
    registrations: [],
    players: {},
    pairings: [],
    past: [],
    lastStandings: [],
  }
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

export class Tournament extends DurableObject<Env> {
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
    })
  }

  async alarm(): Promise<void> {
    await this.ctx.blockConcurrencyWhile(async () => {
      const s = await this.load()
      if (s.state === 'active') await this.closeRound(s)
      else await this.start(s)
      await this.save(s)
    })
  }

  private async start(s: TournamentState): Promise<void> {
    if (s.state !== 'idle') return
    if (s.registrations.length < 2) {
      await this.ctx.storage.setAlarm(nextDailyStart(Date.now()))
      return
    }
    s.players = {}
    for (const email of s.registrations) s.players[email] = { score: 0, opponents: [], byes: 0 }
    s.registrations = []
    s.past = []
    s.round = 1
    s.totalRounds = Math.max(1, Math.ceil(Math.log2(Object.keys(s.players).length)))
    s.state = 'active'
    await this.pairAndAlloc(s)
  }

  private async closeRound(s: TournamentState): Promise<void> {
    if (s.state !== 'active') return
    const now = Date.now()
    if (s.roundDeadline !== null && now < s.roundDeadline - SKEW_MS) {
      // 被 advance 抢先续了下一轮的 deadline，本次 alarm 已过期，重挂即可。
      await this.ctx.storage.setAlarm(s.roundDeadline)
      return
    }
    for (const p of s.pairings) {
      if (p.result !== null) continue
      const present = (p.players.filter((e) => e !== null) as string[]).filter((e) =>
        p.checkedIn.includes(e),
      )
      if (present.length === 1) p.result = present[0] === p.players[0] ? 'a' : 'b'
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
      s.state = 'idle'
      s.round = 0
      s.totalRounds = 0
      s.roundDeadline = null
      s.players = {}
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
            tournament: { round: s.round, players: [p.players[0], p.players[1]!] },
          })
        } catch {
          p.result = 'void' // 建房失败则该局作废
        }
      }
    }
    s.pairings = pairings
    s.roundDeadline = Date.now() + ROUND_MS
    await this.ctx.storage.setAlarm(s.roundDeadline)
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

  private standings(s: TournamentState): Standing[] {
    const buchholz = (p: Player) =>
      p.opponents.reduce((sum, o) => sum + (s.players[o]?.score ?? 0), 0)
    return Object.entries(s.players)
      .map(([email, p]) => ({
        email,
        masked: maskEmail(email),
        score: p.score,
        played: p.opponents.length + p.byes,
        buchholz: buchholz(p),
      }))
      .sort((a, b) => b.score - a.score || b.buchholz - a.buchholz || a.email.localeCompare(b.email))
      .map(({ masked, score, played }) => ({ email: masked, score, played }))
  }

  private toInfo(s: TournamentState, email: string | null): TournamentInfo {
    const now = Date.now()
    const participating = s.state === 'active' && email !== null && email in s.players
    const registered = email !== null && s.registrations.includes(email)
    const showLive = s.state !== 'active' || participating
    const myGame = participating
      ? (s.pairings.find((x) => x.code && x.result === null && x.players.includes(email!))?.code ??
          null)
      : null
    const liveRounds = s.state === 'active' ? [...s.past, s.pairings] : s.past
    return {
      state: s.state,
      now,
      startsAt: nextDailyStart(now),
      round: s.round,
      totalRounds: s.totalRounds,
      playerCount: s.state === 'idle' ? s.registrations.length : Object.keys(s.players).length,
      registered,
      participating,
      myGame: myGame ? { code: myGame } : null,
      roundDeadline: s.roundDeadline,
      // 进行中仅参赛者可见实时榜与配对；非参赛者不开放观战（防多号作弊）。
      standings: s.state === 'idle' ? s.lastStandings : participating ? this.standings(s) : [],
      rounds: showLive ? liveRounds.map((r) => r.map((p) => this.toMatch(p))) : [],
    }
  }

  private toMatch(p: Pairing): Match {
    return {
      a: maskEmail(p.players[0]),
      b: p.players[1] ? maskEmail(p.players[1]) : null,
      status: p.result !== null ? 'done' : p.checkedIn.length >= 2 ? 'playing' : 'pending',
      result: p.result,
    }
  }

  private async armIfNeeded(s: TournamentState): Promise<void> {
    if (s.state === 'idle' && (await this.ctx.storage.getAlarm()) === null) {
      await this.ctx.storage.setAlarm(nextDailyStart(Date.now()))
    }
  }

  private async load(): Promise<TournamentState> {
    const s = (await this.ctx.storage.get<TournamentState>('t')) ?? defaultState()
    s.past ??= []
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
