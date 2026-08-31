import { env, runInDurableObject, SELF } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'

const BASE = 'https://example.com/api/auth'

function accountsStub() {
  return env.ACCOUNTS.get(env.ACCOUNTS.idFromName('accounts'))
}

async function post(path: string, body: object, token?: string): Promise<Response> {
  return SELF.fetch(`${BASE}/${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })
}

async function registerAndGetCode(email: string): Promise<string> {
  const result = await accountsStub().register(email)
  if (!result.ok) throw new Error(result.error)
  return result.code
}

describe('registration', () => {
  it('registers, verifies, and creates a working session', async () => {
    const code = await registerAndGetCode('a@example.com')
    expect(code).toMatch(/^\d{6}$/)

    const res = await post('verify', { email: 'a@example.com', code, password: 'secret123' })
    expect(res.status).toBe(200)
    const { token, email } = await res.json<{ token: string; email: string }>()
    expect(email).toBe('a@example.com')

    const me = await SELF.fetch(`${BASE}/me`, { headers: { Authorization: `Bearer ${token}` } })
    expect(await me.json()).toEqual({ email: 'a@example.com', emailVisible: false })
  })

  it('rejects an invalid email and a short password', async () => {
    const bad = await post('register', { email: 'not-an-email' })
    expect(bad.status).toBe(400)
    const code = await registerAndGetCode('b@example.com')
    const short = await post('verify', { email: 'b@example.com', code, password: 'short' })
    expect(short.status).toBe(400)
    expect(await short.json()).toEqual({ error: 'password_short' })
  })

  it('rejects a wrong code and enforces the attempt limit', async () => {
    const code = await registerAndGetCode('c@example.com')
    const wrong = () => post('verify', { email: 'c@example.com', code: '000000', password: 'secret123' })
    for (let i = 0; i < 4; i++) {
      expect(await (await wrong()).json()).toEqual({ error: 'code_invalid' })
    }
    expect(await (await wrong()).json()).toEqual({ error: 'code_expired' })
    const right = await post('verify', { email: 'c@example.com', code, password: 'secret123' })
    expect(await right.json()).toEqual({ error: 'code_expired' })
  })

  it('rejects a second send inside the cooldown and a duplicate account', async () => {
    await registerAndGetCode('d@example.com')
    const again = await post('register', { email: 'd@example.com' })
    expect(again.status).toBe(429)

    const code = await registerAndGetCode('e@example.com')
    await post('verify', { email: 'e@example.com', code, password: 'secret123' })
    const taken = await post('register', { email: 'e@example.com' })
    expect(taken.status).toBe(409)
    expect(await taken.json()).toEqual({ error: 'email_taken' })
  })
})

describe('login and sessions', () => {
  async function createUser(email: string, password: string): Promise<void> {
    const code = await registerAndGetCode(email)
    await post('verify', { email, code, password })
  }

  it('logs in with the right password and rejects the wrong one', async () => {
    await createUser('f@example.com', 'secret123')
    const ok = await post('login', { email: 'F@Example.com ', password: 'secret123' })
    expect(ok.status).toBe(200)
    expect((await ok.json<{ email: string }>()).email).toBe('f@example.com')

    const bad = await post('login', { email: 'f@example.com', password: 'wrong-pass' })
    expect(bad.status).toBe(401)
    const unknown = await post('login', { email: 'ghost@example.com', password: 'secret123' })
    expect(unknown.status).toBe(401)
  })

  it('lists registered users on the leaderboard, best record first', async () => {
    for (const email of ['h@example.com', 'i@example.com', 'j@example.com']) {
      await createUser(email, 'secret123')
    }
    const stub = accountsStub()
    await stub.recordResult([
      { email: 'i@example.com', outcome: 'win' },
      { email: 'h@example.com', outcome: 'loss' },
    ])
    await stub.recordResult([
      { email: 'i@example.com', outcome: 'draw' },
      { email: 'h@example.com', outcome: 'draw' },
    ])

    const res = await SELF.fetch('https://example.com/api/leaderboard')
    const board = await res.json<Array<{ email: string }>>()
    const emails = ['h***@example.com', 'i***@example.com', 'j***@example.com']
    expect(board.filter((entry) => emails.includes(entry.email))).toEqual([
      { email: 'i***@example.com', wins: 1, losses: 0, draws: 1 },
      { email: 'j***@example.com', wins: 0, losses: 0, draws: 0 },
      { email: 'h***@example.com', wins: 0, losses: 1, draws: 1 },
    ])
  })

  it('reveals the leaderboard email once the owner opts in', async () => {
    await createUser('reveal@example.com', 'secret123')
    const login = await post('login', { email: 'reveal@example.com', password: 'secret123' })
    const { token } = await login.json<{ token: string }>()

    const board = await SELF.fetch('https://example.com/api/leaderboard')
    const masked = await board.json<Array<{ email: string }>>()
    expect(masked.some((entry) => entry.email === 're***@example.com')).toBe(true)

    const set = await post('visibility', { visible: true }, token)
    expect(set.status).toBe(204)
    const me = await SELF.fetch(`${BASE}/me`, { headers: { Authorization: `Bearer ${token}` } })
    expect(await me.json()).toEqual({ email: 'reveal@example.com', emailVisible: true })
    const revealed = await SELF.fetch('https://example.com/api/leaderboard')
    const entries = await revealed.json<Array<{ email: string }>>()
    expect(entries.some((entry) => entry.email === 'reveal@example.com')).toBe(true)

    const anonymous = await post('visibility', { visible: true })
    expect(anonymous.status).toBe(401)
  })

  it('invalidates the session on logout', async () => {
    await createUser('g@example.com', 'secret123')
    const login = await post('login', { email: 'g@example.com', password: 'secret123' })
    const { token } = await login.json<{ token: string }>()

    await post('logout', {}, token)
    const me = await SELF.fetch(`${BASE}/me`, { headers: { Authorization: `Bearer ${token}` } })
    expect(me.status).toBe(401)
  })
})

describe('ELO rating', () => {
  async function register(email: string): Promise<void> {
    const code = await registerAndGetCode(email)
    await post('verify', { email, code, password: 'secret123' })
  }

  function ratingOf(email: string): Promise<number> {
    return runInDurableObject(accountsStub(), async (_, state) => {
      const stats = await state.storage.get<{ rating?: number }>(`stats:${email}`)
      return stats?.rating ?? 1200
    })
  }

  it('shifts both ratings symmetrically after a decisive game', async () => {
    await register('elo-w@example.com')
    await register('elo-l@example.com')
    await accountsStub().recordResult([
      { email: 'elo-w@example.com', outcome: 'win' },
      { email: 'elo-l@example.com', outcome: 'loss' },
    ])
    expect(await ratingOf('elo-w@example.com')).toBe(1220)
    expect(await ratingOf('elo-l@example.com')).toBe(1180)
  })

  it('leaves ratings untouched on a draw between equals', async () => {
    await register('elo-d1@example.com')
    await register('elo-d2@example.com')
    await accountsStub().recordResult([
      { email: 'elo-d1@example.com', outcome: 'draw' },
      { email: 'elo-d2@example.com', outcome: 'draw' },
    ])
    expect(await ratingOf('elo-d1@example.com')).toBe(1200)
    expect(await ratingOf('elo-d2@example.com')).toBe(1200)
  })

  it('does not rate a game against a guest opponent', async () => {
    await register('elo-solo@example.com')
    await accountsStub().recordResult([{ email: 'elo-solo@example.com', outcome: 'win' }])
    expect(await ratingOf('elo-solo@example.com')).toBe(1200)
  })

  it('resolves a match rating from the session, defaulting for unknown tokens', async () => {
    await register('elo-rate@example.com')
    await register('elo-rate-opp@example.com')
    const login = await post('login', { email: 'elo-rate@example.com', password: 'secret123' })
    const { token } = await login.json<{ token: string }>()

    expect(await accountsStub().matchRating('bogus-token')).toBe(1200)
    expect(await accountsStub().matchRating(token)).toBe(1200)
    await accountsStub().recordResult([
      { email: 'elo-rate@example.com', outcome: 'win' },
      { email: 'elo-rate-opp@example.com', outcome: 'loss' },
    ])
    expect(await accountsStub().matchRating(token)).toBe(1220)
  })
})
