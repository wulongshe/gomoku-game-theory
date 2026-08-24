import { env, runInDurableObject, SELF } from 'cloudflare:test'
import { describe, expect, it, vi } from 'vitest'
import { ROOM_CODE_PATTERN, type LobbyServerMessage } from '@/shared/protocol'

interface Client {
  ws: WebSocket
  matched(): Promise<LobbyServerMessage>
}

async function joinLobby(): Promise<Client> {
  const res = await SELF.fetch('https://example.com/api/match/ws', {
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
    expect(await check.json()).toEqual({ exists: true })
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
