import { env, runDurableObjectAlarm, runInDurableObject, SELF } from 'cloudflare:test'
import { describe, expect, it, vi } from 'vitest'
import { ROOM_CODE_PATTERN, type LobbyServerMessage } from '@/shared/protocol'
import { pickSettings, tolerance } from '@/worker/lobby'

interface Client {
  ws: WebSocket
  matched(): Promise<LobbyServerMessage>
}

async function joinLobby(options = 'frames=30&modes=forbidden'): Promise<Client> {
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

describe('pickSettings', () => {
  it('gives the untimed race combo double weight', () => {
    // combos: (30,race)=1, (30,forbidden)=1, (0,race)=2, (0,forbidden)=1 → total 5
    const pick = (roll: number) => pickSettings([30, 0], ['race', 'forbidden'], () => roll)
    expect(pick(0.1)).toEqual({ frame: 30, mode: 'race' })
    expect(pick(0.45)).toEqual({ frame: 0, mode: 'race' })
    expect(pick(0.75)).toEqual({ frame: 0, mode: 'race' })
    expect(pick(0.85)).toEqual({ frame: 0, mode: 'forbidden' })
  })

  it('samples uniformly when the combo is not shared', () => {
    const pick = (roll: number) => pickSettings([30, 60], ['forbidden', 'minus'], () => roll)
    expect(pick(0)).toEqual({ frame: 30, mode: 'forbidden' })
    expect(pick(0.99)).toEqual({ frame: 60, mode: 'minus' })
  })
})

describe('Lobby', () => {
  it('rejects non-websocket requests', async () => {
    const res = await SELF.fetch('https://example.com/api/match/ws?frames=30&modes=forbidden')
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

  it('matches only players whose option sets intersect', async () => {
    const a = await joinLobby('frames=30&modes=forbidden')
    const b = await joinLobby('frames=60&modes=forbidden')
    const c = await joinLobby('frames=60&modes=minus')
    const d = await joinLobby('frames=60&modes=forbidden')
    const [msgB, msgD] = await Promise.all([b.matched(), d.matched()])
    expect(msgB).toEqual(msgD)
    expect(await roomSettings(msgB.code)).toEqual({ frameSeconds: 60, mode: 'forbidden' })
    const e = await joinLobby('frames=30&modes=forbidden,minus')
    expect((await e.matched()).code).toBe((await a.matched()).code)
    const f = await joinLobby('frames=30,60&modes=minus')
    const msgC = await c.matched()
    expect((await f.matched()).code).toBe(msgC.code)
    expect(await roomSettings(msgC.code)).toEqual({ frameSeconds: 60, mode: 'minus' })
  })

  it('settles the room on options both players accept', async () => {
    const a = await joinLobby('frames=60&modes=minus')
    const b = await joinLobby('frames=30,60&modes=forbidden,minus')
    const [msgA] = await Promise.all([a.matched(), b.matched()])
    expect(await roomSettings(msgA.code)).toEqual({ frameSeconds: 60, mode: 'minus' })
  })

  it('prefers the waiting player with the smallest option overlap', async () => {
    const flexible = await joinLobby('frames=30&modes=forbidden,minus')
    const picky = await joinLobby('frames=60&modes=forbidden')
    const joiner = await joinLobby('frames=30,60&modes=forbidden,minus')
    const [msgPicky, msgJoiner] = await Promise.all([picky.matched(), joiner.matched()])
    expect(msgJoiner).toEqual(msgPicky)
    expect(await roomSettings(msgPicky.code)).toEqual({ frameSeconds: 60, mode: 'forbidden' })
    const last = await joinLobby('frames=30&modes=minus')
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
  async function joinRated(rating: number, options = 'frames=30&modes=forbidden'): Promise<Client> {
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
    const a = await joinLobby('frames=0&modes=race')
    await expireAiDeadline()
    const msg = await a.matched()
    expect(msg.type).toBe('matched')
    expect(msg.code).toMatch(ROOM_CODE_PATTERN)

    const room = env.ROOM.get(env.ROOM.idFromName(msg.code))
    const entries = await runInDurableObject(room, (_, state) =>
      state.storage.get(['ai', 'frameSeconds', 'mode']),
    )
    expect(['black', 'white']).toContain(entries.get('ai'))
    expect(entries.get('frameSeconds')).toBe(0)
    expect(entries.get('mode')).toBe('race')
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
