import { env, SELF } from 'cloudflare:test'
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
    expect(await me.json()).toEqual({ email: 'a@example.com' })
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

  it('invalidates the session on logout', async () => {
    await createUser('g@example.com', 'secret123')
    const login = await post('login', { email: 'g@example.com', password: 'secret123' })
    const { token } = await login.json<{ token: string }>()

    await post('logout', {}, token)
    const me = await SELF.fetch(`${BASE}/me`, { headers: { Authorization: `Bearer ${token}` } })
    expect(me.status).toBe(401)
  })
})
