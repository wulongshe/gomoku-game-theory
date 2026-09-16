import { env, runDurableObjectAlarm, runInDurableObject, SELF } from 'cloudflare:test'
import { describe, expect, it, vi } from 'vitest'
import { ROOM_CODE_PATTERN, type LobbyServerMessage } from '@/shared/protocol'
import { pickFrame, tolerance } from '@/worker/lobby'

interface Client {
  ws: WebSocket
  matched(): Promise<LobbyServerMessage>
}

async function joinLobby(options = 'frames=30'): Promise<Client> {
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

async function roomSettings(code: string): Promise<Record<string, unknown>> {
  const stub = env.ROOM.get(env.ROOM.idFromName(code))
  const entries = await runInDurableObject(stub, (_, state) =>
    state.storage.get(['frameSeconds', 'mode']),
  )
  return Object.fromEntries(entries)
}

describe('pickFrame', () => {
  it('samples uniformly across the frames', () => {
    expect(pickFrame([30, 60], () => 0)).toBe(30)
    expect(pickFrame([30, 60], () => 0.99)).toBe(60)
  })
})

describe('Lobby', () => {
  it('rejects non-websocket requests', async () => {
    const res = await SELF.fetch('https://example.com/api/match/ws?frames=30')
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

  it('matches only players whose frame choices intersect', async () => {
    const a = await joinLobby('frames=30')
    const b = await joinLobby('frames=60')
    const c = await joinLobby('frames=0')
    const d = await joinLobby('frames=60')
    const [msgB, msgD] = await Promise.all([b.matched(), d.matched()])
    expect(msgB).toEqual(msgD)
    expect(await roomSettings(msgB.code)).toEqual({ frameSeconds: 60, mode: 'forbidden' })
    const e = await joinLobby('frames=30')
    expect((await e.matched()).code).toBe((await a.matched()).code)
    const f = await joinLobby('frames=0,60')
    const msgC = await c.matched()
    expect((await f.matched()).code).toBe(msgC.code)
    expect(await roomSettings(msgC.code)).toEqual({ frameSeconds: 0, mode: 'forbidden' })
  })

  it('settles the room on a frame both players accept, always in forbidden mode', async () => {
    const a = await joinLobby('frames=60')
    const b = await joinLobby('frames=30,60')
    const [msgA] = await Promise.all([a.matched(), b.matched()])
    expect(await roomSettings(msgA.code)).toEqual({ frameSeconds: 60, mode: 'forbidden' })
  })

  it('prefers the waiting player with the smallest option overlap', async () => {
    const flexible = await joinLobby('frames=30,0')
    const picky = await joinLobby('frames=60')
    const joiner = await joinLobby('frames=30,60,0')
    const [msgPicky, msgJoiner] = await Promise.all([picky.matched(), joiner.matched()])
    expect(msgJoiner).toEqual(msgPicky)
    expect(await roomSettings(msgPicky.code)).toEqual({ frameSeconds: 60, mode: 'forbidden' })
    const last = await joinLobby('frames=30')
    expect((await last.matched()).code).toBe((await flexible.matched()).code)
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
  async function joinRated(rating: number, options = 'frames=30'): Promise<Client> {
    const stub = env.LOBBY.get(env.LOBBY.idFromName('lobby'))
    const res = await stub.fetch(`https://lobby/api/match/ws?${options}&rating=${rating}`, {
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
    const a = await joinLobby('frames=0')
    await expireAiDeadline()
    const msg = await a.matched()
    expect(msg.type).toBe('matched')
    expect(msg.code).toMatch(ROOM_CODE_PATTERN)

    const room = env.ROOM.get(env.ROOM.idFromName(msg.code))
    const entries = await runInDurableObject(room, (_, state) =>
      state.storage.get(['aiSeats', 'frameSeconds', 'mode']),
    )
    const aiSeats = Object.keys((entries.get('aiSeats') as Record<string, unknown>) ?? {})
    expect(aiSeats).toHaveLength(1)
    expect(['black', 'white']).toContain(aiSeats[0])
    expect(entries.get('frameSeconds')).toBe(0)
    expect(entries.get('mode')).toBe('forbidden')
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
