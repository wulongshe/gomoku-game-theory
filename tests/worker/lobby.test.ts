import { env, runDurableObjectAlarm, runInDurableObject, SELF } from 'cloudflare:test'
import { describe, expect, it, vi } from 'vitest'
import { ROOM_CODE_PATTERN, type LobbyServerMessage } from '@/shared/protocol'
import { matchOpen, matchWindow, tolerance } from '@/worker/lobby'

interface Client {
  ws: WebSocket
  matched(): Promise<LobbyServerMessage>
}

async function joinLobby(options = ''): Promise<Client> {
  const res = await SELF.fetch(`https://example.com/api/match/ws?${options}`, {
    headers: { Upgrade: 'websocket' },
  })
  expect(res.status).toBe(101)
  const ws = res.webSocket!
  ws.accept()

  const first = new Promise<LobbyServerMessage>((resolve) => {
    ws.addEventListener(
      'message',
      (event) => resolve(JSON.parse(event.data as string) as LobbyServerMessage),
      { once: true },
    )
  })

  return { ws, matched: () => first }
}

// 北京时间 (h:m) 对应的 UTC 时间戳，日期固定取 2026-09-23。
const bj = (h: number, m = 0, dayOffset = 0) => Date.UTC(2026, 8, 23 + dayOffset, h - 8, m)

describe('matchWindow', () => {
  it('opens 20:00-22:00 Beijing time by default', () => {
    expect(matchWindow(bj(21))).toEqual({ now: bj(21), opensAt: bj(20), closesAt: bj(22) })
    expect(matchOpen(bj(20))).toBe(true)
    expect(matchOpen(bj(21, 59))).toBe(true)
    expect(matchOpen(bj(22))).toBe(false)
    expect(matchOpen(bj(19, 59))).toBe(false)
  })

  it('points at the next window once today is over', () => {
    expect(matchWindow(bj(22))).toMatchObject({ opensAt: bj(20, 0, 1), closesAt: bj(22, 0, 1) })
    expect(matchWindow(bj(3))).toMatchObject({ opensAt: bj(20), closesAt: bj(22) })
  })

  it('honours a configured window, crossing midnight and the UTC day boundary', () => {
    expect(matchWindow(bj(0, 10), '23:50-00:20')).toMatchObject({
      opensAt: bj(23, 50, -1),
      closesAt: bj(0, 20),
    })
    expect(matchWindow(bj(2, 30), '02:00-03:00')).toMatchObject({ opensAt: bj(2), closesAt: bj(3) })
    expect(matchOpen(bj(2, 30), '02:00-03:00')).toBe(true)
  })

  it('treats an empty range as always open and garbage as the default', () => {
    expect(matchOpen(bj(5), '00:00-00:00')).toBe(true)
    expect(matchOpen(bj(5), 'nonsense')).toBe(false)
    expect(matchOpen(bj(21), 'nonsense')).toBe(true)
  })
})

describe('Lobby', () => {
  it('rejects non-websocket requests', async () => {
    const res = await SELF.fetch('https://example.com/api/match/ws')
    expect(res.status).toBe(426)
  })

  it('matches two waiting players into the same room', async () => {
    const a = await joinLobby()
    const b = await joinLobby()
    const [msgA, msgB] = await Promise.all([a.matched(), b.matched()])
    expect(msgA.type).toBe('matched')
    expect(msgA.code).toMatch(ROOM_CODE_PATTERN)
    expect(msgB).toEqual(msgA)
    const check = await SELF.fetch(`https://example.com/api/rooms/${msgA.code}`)
    expect(await check.json()).toEqual({ exists: true, full: false })
  })

  it('pairs players in connection order across matches', async () => {
    const a = await joinLobby()
    const b = await joinLobby()
    const first = await b.matched()
    const c = await joinLobby()
    const d = await joinLobby()
    const second = await d.matched()
    expect(second.code).not.toBe(first.code)
    expect((await a.matched()).code).toBe(first.code)
    expect((await c.matched()).code).toBe(second.code)
  })

  it('does not match a player who cancelled before an opponent arrives', async () => {
    const quitter = await joinLobby()
    quitter.ws.close(1000, 'cancelled')
    const stub = env.LOBBY.get(env.LOBBY.idFromName('lobby'))
    await vi.waitFor(async () => {
      const open = await runInDurableObject(stub, (_, state) => state.getWebSockets().length)
      expect(open).toBe(0)
    })
    const a = await joinLobby()
    const b = await joinLobby()
    const [msgA, msgB] = await Promise.all([a.matched(), b.matched()])
    expect(msgA).toEqual(msgB)
  })
})

describe('rating bands', () => {
  async function joinRated(rating: number): Promise<Client> {
    const stub = env.LOBBY.get(env.LOBBY.idFromName('lobby'))
    const res = await stub.fetch(`https://lobby/api/match/ws?rating=${rating}`, {
      headers: { Upgrade: 'websocket' },
    })
    expect(res.status).toBe(101)
    const ws = res.webSocket!
    ws.accept()
    const first = new Promise<LobbyServerMessage>((resolve) => {
      ws.addEventListener(
        'message',
        (event) => resolve(JSON.parse(event.data as string) as LobbyServerMessage),
        { once: true },
      )
    })
    return { ws, matched: () => first }
  }

  it('widens the acceptable gap the longer a player waits', () => {
    expect(tolerance(0)).toBe(120)
    expect(tolerance(10_000)).toBe(520)
    expect(tolerance(30_000)).toBe(1320)
  })

  it('matches players whose ratings are within tolerance', async () => {
    const a = await joinRated(1200)
    const b = await joinRated(1260)
    const [msgA, msgB] = await Promise.all([a.matched(), b.matched()])
    expect(msgA.type).toBe('matched')
    expect(msgB).toEqual(msgA)
  })

  it('holds distant ratings apart, then matches once the gap widens', async () => {
    const stub = env.LOBBY.get(env.LOBBY.idFromName('lobby'))
    const a = await joinRated(1200)
    const b = await joinRated(1800)

    const settled = await Promise.race([
      a.matched().then(() => 'matched' as const),
      new Promise<'pending'>((resolve) => setTimeout(() => resolve('pending'), 60)),
    ])
    expect(settled).toBe('pending')

    // 模拟久候：前移入队时间，容差随之放宽到足以成局，再触发定时重试。
    await runInDurableObject(stub, (_, state) => {
      for (const ws of state.getWebSockets()) {
        const opts = ws.deserializeAttachment() as { joinedAt: number }
        ws.serializeAttachment({ ...opts, joinedAt: Date.now() - 30_000 })
      }
    })
    await runDurableObjectAlarm(stub)

    const [msgA, msgB] = await Promise.all([a.matched(), b.matched()])
    expect(msgA.type).toBe('matched')
    expect(msgB).toEqual(msgA)
  })
})

describe('AI fallback', () => {
  const stub = () => env.LOBBY.get(env.LOBBY.idFromName('lobby'))

  // 模拟久候：把 AI 顶替时点拨到过去，再触发闹钟。
  async function expireAiDeadline(): Promise<void> {
    await runInDurableObject(stub(), (_, state) => {
      for (const ws of state.getWebSockets()) {
        const opts = ws.deserializeAttachment() as { aiAt: number }
        ws.serializeAttachment({ ...opts, aiAt: Date.now() - 1 })
      }
    })
    await runDurableObjectAlarm(stub())
  }

  it('hands a lone waiter an AI room once the deadline passes', async () => {
    const a = await joinLobby()
    await expireAiDeadline()
    const msg = await a.matched()
    expect(msg.type).toBe('matched')
    expect(msg.code).toMatch(ROOM_CODE_PATTERN)

    const room = env.ROOM.get(env.ROOM.idFromName(msg.code))
    const entries = await runInDurableObject(room, (_, state) =>
      state.storage.get(['aiSeats', 'matched']),
    )
    const aiSeats = Object.keys((entries.get('aiSeats') as Record<string, unknown>) ?? {})
    expect(aiSeats).toHaveLength(1)
    expect(['black', 'white']).toContain(aiSeats[0])
    expect(entries.get('matched')).toBe(true)
  })

  it('keeps waiting for humans before the deadline', async () => {
    const a = await joinLobby()
    await runDurableObjectAlarm(stub())
    const b = await joinLobby()
    const [msgA, msgB] = await Promise.all([a.matched(), b.matched()])
    expect(msgA).toEqual(msgB)
    const room = env.ROOM.get(env.ROOM.idFromName(msgA.code))
    expect(await runInDurableObject(room, (_, state) => state.storage.get('ai'))).toBeUndefined()
  })
})
