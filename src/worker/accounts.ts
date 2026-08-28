import { DurableObject } from 'cloudflare:workers'
import { maskEmail } from '@/shared/protocol'

const CODE_TTL = 10 * 60_000
const SEND_COOLDOWN = 60_000
const SESSION_TTL = 30 * 24 * 3600_000
const MAX_CODE_ATTEMPTS = 5

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

export interface EmailVisibility {
  leaderboard: boolean
  game: boolean
}

interface UserRecord {
  hash: string
  salt: string
  createdAt: number
  emailVisibility?: Partial<EmailVisibility>
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

  async me(token: string): Promise<{ email: string; emailVisibility: EmailVisibility } | null> {
    const session = await this.ctx.storage.get<SessionRecord>(`session:${token}`)
    if (!session) return null
    if (Date.now() > session.expires) {
      await this.ctx.storage.delete(`session:${token}`)
      return null
    }
    const user = await this.ctx.storage.get<UserRecord>(`user:${session.email}`)
    return {
      email: session.email,
      emailVisibility: {
        leaderboard: user?.emailVisibility?.leaderboard ?? false,
        game: user?.emailVisibility?.game ?? false,
      },
    }
  }

  async setEmailVisible(
    token: string,
    scope: keyof EmailVisibility,
    visible: boolean,
  ): Promise<boolean> {
    const profile = await this.me(token)
    if (!profile) return false
    const user = await this.ctx.storage.get<UserRecord>(`user:${profile.email}`)
    if (!user) return false
    user.emailVisibility = { ...user.emailVisibility, [scope]: visible }
    await this.ctx.storage.put(`user:${profile.email}`, user)
    return true
  }

  async displayEmails(emails: (string | null)[]): Promise<(string | null)[]> {
    return Promise.all(
      emails.map(async (email) => {
        if (!email) return null
        const user = await this.ctx.storage.get<UserRecord>(`user:${email}`)
        return user?.emailVisibility?.game ? email : maskEmail(email)
      }),
    )
  }

  async logout(token: string): Promise<void> {
    await this.ctx.storage.delete(`session:${token}`)
  }

  async recordResult(results: Array<{ email: string; outcome: GameOutcome }>): Promise<void> {
    for (const { email, outcome } of results) {
      const stats = (await this.ctx.storage.get<StatsRecord>(`stats:${email}`)) ?? {
        wins: 0,
        losses: 0,
        draws: 0,
      }
      if (outcome === 'win') stats.wins += 1
      else if (outcome === 'loss') stats.losses += 1
      else stats.draws += 1
      await this.ctx.storage.put(`stats:${email}`, stats)
    }
  }

  async leaderboard(): Promise<LeaderboardEntry[]> {
    const users = await this.ctx.storage.list<UserRecord>({ prefix: 'user:' })
    const stats = await this.ctx.storage.list<StatsRecord>({ prefix: 'stats:' })
    return [...users.entries()]
      .map(([key, user]) => {
        const email = key.slice('user:'.length)
        return {
          email: user.emailVisibility?.leaderboard ? email : maskEmail(email),
          wins: 0,
          losses: 0,
          draws: 0,
          ...stats.get(`stats:${email}`),
        }
      })
      .sort((a, b) => b.wins - a.wins || a.losses - b.losses || a.email.localeCompare(b.email))
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
