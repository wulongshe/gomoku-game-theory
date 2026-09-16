import { env, SELF } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import type { ChallengeInfo } from '@/shared/protocol'

// Accounts DO 的存储在同一测试文件内共享，各用例用各自的残局 id 隔离。
const base = (id: string) => `https://example.com/api/challenge/${id}`

async function session(email: string): Promise<string> {
  const accounts = env.ACCOUNTS.get(env.ACCOUNTS.idFromName('accounts'))
  const reg = await accounts.register(email)
  if (!reg.ok) throw new Error(reg.error)
  const verified = await accounts.verify(email, reg.code, 'secret123')
  if (!verified.ok) throw new Error(verified.error)
  return verified.token
}

function clear(id: string, difficulty: unknown, token?: string): Promise<Response> {
  return SELF.fetch(`${base(id)}/clear`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ difficulty }),
  })
}

async function info(id: string, token?: string): Promise<ChallengeInfo> {
  const res = await SELF.fetch(base(id), { headers: token ? { Authorization: `Bearer ${token}` } : {} })
  expect(res.status).toBe(200)
  return res.json<ChallengeInfo>()
}

describe('challenge clears', () => {
  it('starts empty and requires login to record', async () => {
    const id = '0000000000000001'
    expect(await info(id)).toEqual({ clears: [], mine: [] })
    expect((await clear(id, 'easy')).status).toBe(401)
    expect((await clear(id, 'easy', 'bogus')).status).toBe(401)
  })

  it('records each cleared difficulty and shows the best one per user', async () => {
    const id = '0000000000000002'
    const a = await session('alice@example.com')
    const first = await (await clear(id, 'easy', a)).json<ChallengeInfo>()
    expect(first).toEqual({ clears: [{ email: 'al***@example.com', difficulty: 'easy' }], mine: ['easy'] })
    const second = await (await clear(id, 'hard', a)).json<ChallengeInfo>()
    expect(second.clears).toEqual([{ email: 'al***@example.com', difficulty: 'hard' }])
    expect(second.mine).toEqual(['easy', 'hard'])
    expect(await info(id, a)).toEqual(second)
    expect((await info(id)).mine).toEqual([])
  })

  it('ranks users by best difficulty, earliest first within a tie', async () => {
    const id = '0000000000000003'
    const a = await session('a@example.com')
    const b = await session('b@example.com')
    const c = await session('c@example.com')
    await clear(id, 'normal', a)
    await clear(id, 'master', b)
    await clear(id, 'normal', c)
    expect((await info(id)).clears.map((row) => row.difficulty)).toEqual(['master', 'normal', 'normal'])
    expect((await info(id)).clears.map((row) => row.email)).toEqual([
      'b***@example.com',
      'a***@example.com',
      'c***@example.com',
    ])
  })

  it('rejects unknown difficulties and malformed ids', async () => {
    const a = await session('d@example.com')
    expect((await clear('0000000000000004', 'insane', a)).status).toBe(400)
    const bad = await SELF.fetch('https://example.com/api/challenge/nope')
    expect(bad.status).toBe(404)
  })
})
