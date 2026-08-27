import { DurableObject } from 'cloudflare:workers'

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

interface UserRecord {
  hash: string
  salt: string
  createdAt: number
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

  async me(token: string): Promise<string | null> {
    const session = await this.ctx.storage.get<SessionRecord>(`session:${token}`)
    if (!session) return null
    if (Date.now() > session.expires) {
      await this.ctx.storage.delete(`session:${token}`)
      return null
    }
    return session.email
  }

  async logout(token: string): Promise<void> {
    await this.ctx.storage.delete(`session:${token}`)
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
