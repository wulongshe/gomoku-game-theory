import { env, runInDurableObject, SELF } from 'cloudflare:test'
import { describe, expect, it, vi } from 'vitest'
import { ROOM_CODE_PATTERN, type LobbyServerMessage } from '@/shared/protocol'
import { pickSettings } from '@/worker/lobby'

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
    const pick = (roll: number) => pickSettings([30, 60], ['forbidden', 'half'], () => roll)
    expect(pick(0)).toEqual({ frame: 30, mode: 'forbidden' })
    expect(pick(0.99)).toEqual({ frame: 60, mode: 'half' })
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
    const c = await joinLobby('frames=60&modes=half')
    const d = await joinLobby('frames=60&modes=forbidden')
    const [msgB, msgD] = await Promise.all([b.matched(), d.matched()])
    expect(msgB).toEqual(msgD)
    expect(await roomSettings(msgB.code)).toEqual({ frameSeconds: 60, mode: 'forbidden' })
    const e = await joinLobby('frames=30&modes=forbidden,half')
    expect((await e.matched()).code).toBe((await a.matched()).code)
    const f = await joinLobby('frames=30,60&modes=half')
    const msgC = await c.matched()
    expect((await f.matched()).code).toBe(msgC.code)
    expect(await roomSettings(msgC.code)).toEqual({ frameSeconds: 60, mode: 'half' })
  })

  it('settles the room on options both players accept', async () => {
    const a = await joinLobby('frames=60&modes=half')
    const b = await joinLobby('frames=30,60&modes=forbidden,half')
    const [msgA] = await Promise.all([a.matched(), b.matched()])
    expect(await roomSettings(msgA.code)).toEqual({ frameSeconds: 60, mode: 'half' })
  })

  it('prefers the waiting player with the smallest option overlap', async () => {
    const flexible = await joinLobby('frames=30&modes=forbidden,half')
    const picky = await joinLobby('frames=60&modes=forbidden')
    const joiner = await joinLobby('frames=30,60&modes=forbidden,half')
    const [msgPicky, msgJoiner] = await Promise.all([picky.matched(), joiner.matched()])
    expect(msgJoiner).toEqual(msgPicky)
    expect(await roomSettings(msgPicky.code)).toEqual({ frameSeconds: 60, mode: 'forbidden' })
    const last = await joinLobby('frames=30&modes=half')
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
