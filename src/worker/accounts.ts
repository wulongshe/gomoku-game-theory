import { DurableObject } from 'cloudflare:workers'
import { maskEmail } from '@/shared/protocol'

const CODE_TTL = 10 * 60_000
const SEND_COOLDOWN = 60_000
const SESSION_TTL = 30 * 24 * 3600_000
const MAX_CODE_ATTEMPTS = 5

export const RATING_DEFAULT = 1200
const PROVISIONAL_GAMES = 10
const K_PROVISIONAL = 40
const K_ESTABLISHED = 20

export type RegisterResult =
  | { ok: true; code: string }
  | { ok: false; error: 'email_taken' | 'cooldown' }
export type VerifyResult =
  | { ok: true; token: string }
  | { ok: false; error: 'code_invalid' | 'code_expired' }
export type LoginResult = { ok: true; token: string } | { ok: false; error: 'bad_credentials' }
export type GameOutcome = 'win' | 'loss' | 'draw'

export interface LeaderboardEntry {
  email: string
  wins: number
  losses: number
  draws: number
}

interface UserRecord {
  hash: string
  salt: string
  createdAt: number
  emailVisible?: boolean
}

interface PendingRecord {
  code: string
  sentAt: number
  attempts: number
}

interface SessionRecord {
  email: string
  expires: number
}

interface StatsRecord {
  wins: number
  losses: number
  draws: number
  rating: number
}

function randomCode(): string {
  return String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, '0')
}

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function fromHex(hex: string): Uint8Array {
  return new Uint8Array(hex.match(/../g)!.map((b) => parseInt(b, 16)))
}

async function hashPassword(password: string, salt: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  )
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100_000 },
    key,
    256,
  )
  return toHex(new Uint8Array(bits))
}

function totalGames(stats: StatsRecord): number {
  return stats.wins + stats.losses + stats.draws
}

function outcomeScore(outcome: GameOutcome): number {
  return outcome === 'win' ? 1 : outcome === 'draw' ? 0.5 : 0
}

function kFactor(games: number): number {
  return games < PROVISIONAL_GAMES ? K_PROVISIONAL : K_ESTABLISHED
}

export class Accounts extends DurableObject<Env> {
  async register(email: string): Promise<RegisterResult> {
    if (await this.ctx.storage.get<UserRecord>(`user:${email}`)) {
      return { ok: false, error: 'email_taken' }
    }
    const pending = await this.ctx.storage.get<PendingRecord>(`pending:${email}`)
    if (pending && Date.now() - pending.sentAt < SEND_COOLDOWN) {
      return { ok: false, error: 'cooldown' }
    }
    const code = randomCode()
    await this.ctx.storage.put(`pending:${email}`, {
      code,
      sentAt: Date.now(),
      attempts: 0,
    } satisfies PendingRecord)
    return { ok: true, code }
  }

  async verify(email: string, code: string, password: string): Promise<VerifyResult> {
    const pending = await this.ctx.storage.get<PendingRecord>(`pending:${email}`)
    if (!pending || Date.now() - pending.sentAt > CODE_TTL) {
      return { ok: false, error: 'code_expired' }
    }
    if (pending.code !== code) {
      pending.attempts += 1
      if (pending.attempts >= MAX_CODE_ATTEMPTS) {
        await this.ctx.storage.delete(`pending:${email}`)
        return { ok: false, error: 'code_expired' }
      }
      await this.ctx.storage.put(`pending:${email}`, pending)
      return { ok: false, error: 'code_invalid' }
    }
    const salt = crypto.getRandomValues(new Uint8Array(16))
    await this.ctx.storage.put(`user:${email}`, {
      hash: await hashPassword(password, salt),
      salt: toHex(salt),
      createdAt: Date.now(),
    } satisfies UserRecord)
    await this.ctx.storage.delete(`pending:${email}`)
    return { ok: true, token: await this.createSession(email) }
  }

  async login(email: string, password: string): Promise<LoginResult> {
    const user = await this.ctx.storage.get<UserRecord>(`user:${email}`)
    if (!user || (await hashPassword(password, fromHex(user.salt))) !== user.hash) {
      return { ok: false, error: 'bad_credentials' }
    }
    return { ok: true, token: await this.createSession(email) }
  }

  async me(token: string): Promise<{ email: string; emailVisible: boolean } | null> {
    const session = await this.ctx.storage.get<SessionRecord>(`session:${token}`)
    if (!session) return null
    if (Date.now() > session.expires) {
      await this.ctx.storage.delete(`session:${token}`)
      return null
    }
    const user = await this.ctx.storage.get<UserRecord>(`user:${session.email}`)
    return { email: session.email, emailVisible: user?.emailVisible ?? false }
  }

  async setEmailVisible(token: string, visible: boolean): Promise<boolean> {
    const profile = await this.me(token)
    if (!profile) return false
    const user = await this.ctx.storage.get<UserRecord>(`user:${profile.email}`)
    if (!user) return false
    user.emailVisible = visible
    await this.ctx.storage.put(`user:${profile.email}`, user)
    return true
  }

  async displayEmails(emails: (string | null)[]): Promise<(string | null)[]> {
    return Promise.all(
      emails.map(async (email) => {
        if (!email) return null
        const user = await this.ctx.storage.get<UserRecord>(`user:${email}`)
        return user?.emailVisible ? email : maskEmail(email)
      }),
    )
  }

  async logout(token: string): Promise<void> {
    await this.ctx.storage.delete(`session:${token}`)
  }

  async recordResult(
    results: Array<{ email: string; outcome: GameOutcome }>,
    soloRated = false,
  ): Promise<void> {
    const records = await Promise.all(
      results.map(async ({ email, outcome }) => {
        const raw = await this.ctx.storage.get<StatsRecord>(`stats:${email}`)
        const stats: StatsRecord = {
          wins: raw?.wins ?? 0,
          losses: raw?.losses ?? 0,
          draws: raw?.draws ?? 0,
          rating: raw?.rating ?? RATING_DEFAULT,
        }
        return { email, outcome, stats }
      }),
    )
    // 双方均为注册账号时互相结算 ELO；soloRated（匹配局对手为游客/隐身 AI）时，
    // 单边按默认分的虚拟对手结算。K 值都由赛前局数决定。
    if (records.length === 2) {
      const [a, b] = records
      const expectedA = 1 / (1 + 10 ** ((b.stats.rating - a.stats.rating) / 400))
      const deltaA = kFactor(totalGames(a.stats)) * (outcomeScore(a.outcome) - expectedA)
      const deltaB = kFactor(totalGames(b.stats)) * (outcomeScore(b.outcome) - (1 - expectedA))
      a.stats.rating = Math.round(a.stats.rating + deltaA)
      b.stats.rating = Math.round(b.stats.rating + deltaB)
    } else if (records.length === 1 && soloRated) {
      const [a] = records
      const expected = 1 / (1 + 10 ** ((RATING_DEFAULT - a.stats.rating) / 400))
      const delta = kFactor(totalGames(a.stats)) * (outcomeScore(a.outcome) - expected)
      a.stats.rating = Math.round(a.stats.rating + delta)
    }
    for (const { email, outcome, stats } of records) {
      if (outcome === 'win') stats.wins += 1
      else if (outcome === 'loss') stats.losses += 1
      else stats.draws += 1
      await this.ctx.storage.put(`stats:${email}`, stats)
    }
  }

  async matchRating(token: string): Promise<number> {
    const session = await this.ctx.storage.get<SessionRecord>(`session:${token}`)
    if (!session || Date.now() > session.expires) return RATING_DEFAULT
    const stats = await this.ctx.storage.get<StatsRecord>(`stats:${session.email}`)
    return stats?.rating ?? RATING_DEFAULT
  }

  // me 为请求者在榜中的下标（未登录/未上榜为 null）：脱敏后的邮箱可能撞车，只有服务端能可靠定位「我」。
  async leaderboard(token: string | null = null): Promise<{
    entries: LeaderboardEntry[]
    me: number | null
  }> {
    const myEmail = token ? ((await this.me(token))?.email ?? null) : null
    const users = await this.ctx.storage.list<UserRecord>({ prefix: 'user:' })
    const stats = await this.ctx.storage.list<StatsRecord>({ prefix: 'stats:' })
    const rows = [...users.entries()].map(([key, user]) => {
      const email = key.slice('user:'.length)
      const record = stats.get(`stats:${email}`)
      return {
        email,
        visible: user.emailVisible ?? false,
        wins: record?.wins ?? 0,
        losses: record?.losses ?? 0,
        draws: record?.draws ?? 0,
      }
    })
    rows.sort((a, b) => b.wins - a.wins || a.losses - b.losses || a.email.localeCompare(b.email))
    const index = myEmail === null ? -1 : rows.findIndex((row) => row.email === myEmail)
    return {
      entries: rows.map(({ email, visible, wins, losses, draws }) => ({
        email: visible ? email : maskEmail(email),
        wins,
        losses,
        draws,
      })),
      me: index < 0 ? null : index,
    }
  }

  private async createSession(email: string): Promise<string> {
    const token = toHex(crypto.getRandomValues(new Uint8Array(32)))
    await this.ctx.storage.put(`session:${token}`, {
      email,
      expires: Date.now() + SESSION_TTL,
    } satisfies SessionRecord)
    return token
  }
}
