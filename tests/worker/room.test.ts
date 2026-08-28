import { env, runDurableObjectAlarm, runInDurableObject, SELF } from 'cloudflare:test'
import { describe, expect, it, vi } from 'vitest'
import { cellAt, type Point } from '@/engine/game'
import type { ServerMessage } from '@/shared/protocol'

interface Client {
  ws: WebSocket
  next(type: ServerMessage['type']): Promise<ServerMessage>
  submit(frame: number, point: Point | null, final?: boolean): void
  ready(): void
  rematch(frameSeconds?: number, mode?: string): void
}

async function createRoom(code: string, frame?: number, mode?: string): Promise<void> {
  const params = new URLSearchParams()
  if (frame !== undefined) params.set('frame', String(frame))
  if (mode) params.set('mode', mode)
  await env.ROOM.get(env.ROOM.idFromName(code)).fetch(`https://room/create?${params}`, {
    method: 'POST',
  })
}

async function connect(code: string, token: string, auth?: string): Promise<Client> {
  const res = await SELF.fetch(
    `https://example.com/api/rooms/${code}/ws?token=${token}${auth ? `&auth=${auth}` : ''}`,
    { headers: { Upgrade: 'websocket' } },
  )
  expect(res.status).toBe(101)
  const ws = res.webSocket!
  ws.accept()

  const queue: ServerMessage[] = []
  const waiters: Array<() => void> = []
  ws.addEventListener('message', (event) => {
    queue.push(JSON.parse(event.data as string) as ServerMessage)
    waiters.shift()?.()
  })

  return {
    ws,
    async next(type) {
      while (true) {
        const msg = queue.shift()
        if (msg?.type === type) return msg
        if (msg?.type === 'error') throw new Error(`unexpected error: ${msg.message}`)
        if (!msg) await new Promise<void>((resolve) => waiters.push(resolve))
      }
    },
    submit(frame, point, final = true) {
      ws.send(JSON.stringify({ type: 'submit', frame, point, final }))
    },
    ready() {
      ws.send(JSON.stringify({ type: 'ready' }))
    },
    rematch(frameSeconds = 30, mode = 'forbidden') {
      ws.send(JSON.stringify({ type: 'rematch', frameSeconds, mode }))
    },
  }
}

async function startGame(code: string): Promise<[Client, Client]> {
  await createRoom(code)
  const a = await connect(code, 'token-a')
  const b = await connect(code, 'token-b')
  expect(await a.next('joined')).toMatchObject({ seat: 'black' })
  expect(await b.next('joined')).toMatchObject({ seat: 'white' })
  a.ready()
  b.ready()
  await a.next('start')
  await b.next('start')
  return [a, b]
}

async function waitForEmpty(stub: DurableObjectStub): Promise<void> {
  await vi.waitFor(async () => {
    const sockets = await runInDurableObject(stub, (instance) =>
      (instance as unknown as { ctx: DurableObjectState }).ctx.getWebSockets().length,
    )
    expect(sockets).toBe(0)
  })
}

async function settledOnBoth(a: Client, b: Client) {
  const settled = await a.next('frame_settled')
  expect(await b.next('frame_settled')).toEqual(settled)
  if (settled.type !== 'frame_settled') throw new Error('unreachable')
  return settled
}

const BLACK_WIN_LINE: Point[] = [4, 5, 7, 8].map((x) => ({ x, y: 7 }))
const WHITE_SIDE_MOVES: Point[] = [0, 1, 2, 3].map((x) => ({ x, y: 0 }))

async function playToBlackWin(a: Client, b: Client) {
  a.submit(1, { x: 6, y: 7 })
  b.submit(1, { x: 7, y: 8 })
  await settledOnBoth(a, b)
  for (let i = 0; i < 3; i++) {
    a.submit(i + 2, BLACK_WIN_LINE[i])
    b.submit(i + 2, WHITE_SIDE_MOVES[i])
    await settledOnBoth(a, b)
  }
  a.submit(5, BLACK_WIN_LINE[3])
  b.submit(5, WHITE_SIDE_MOVES[3])
  return settledOnBoth(a, b)
}

describe('Room', () => {
  it('rejects joining a room that was never created', async () => {
    const res = await SELF.fetch('https://example.com/api/rooms/9099/ws?token=token-a', {
      headers: { Upgrade: 'websocket' },
    })
    expect(res.status).toBe(404)
  })

  it('rejects re-creating an already claimed room code with 409', async () => {
    await createRoom('1042')
    const again = await env.ROOM.get(env.ROOM.idFromName('1042')).fetch(
      'https://room/create?frame=30&mode=forbidden',
      { method: 'POST' },
    )
    expect(again.status).toBe(409)
  })

  it('keeps a waiting room alive while its creator reconnects', async () => {
    await createRoom('1018')
    const a = await connect('1018', 'token-a')
    expect(await a.next('joined')).toMatchObject({ seat: 'black' })
    a.ws.close()
    const a2 = await connect('1018', 'token-a')
    expect(await a2.next('joined')).toMatchObject({ seat: 'black' })
  })

  it('seats two players and starts once both are ready', async () => {
    await createRoom('1001')
    const a = await connect('1001', 'token-a')
    expect(await a.next('joined')).toMatchObject({ seat: 'black' })
    expect(await a.next('lobby')).toMatchObject({ present: { black: true, white: false } })
    const b = await connect('1001', 'token-b')
    expect(await b.next('joined')).toMatchObject({ seat: 'white' })
    expect(await b.next('lobby')).toMatchObject({
      present: { black: true, white: true },
      ready: { black: false, white: false },
    })
    a.ready()
    expect(await b.next('lobby')).toMatchObject({ ready: { black: true, white: false } })
    b.ready()
    const start = await a.next('start')
    expect(start).toMatchObject({
      state: { frame: 1, phase: 'playing' },
      submitted: { black: false, white: false },
      yourChoice: null,
    })
    expect(await b.next('start')).toEqual(start)
  })

  it('runs frames at the configured duration', async () => {
    await createRoom('1020', 60)
    const a = await connect('1020', 'token-a')
    const b = await connect('1020', 'token-b')
    a.ready()
    b.ready()
    const start = await a.next('start')
    if (start.type !== 'start') throw new Error('unreachable')
    expect(start.frameSeconds).toBe(60)
    expect(start.deadline).toBeGreaterThan(Date.now() + 55_000)
    await b.next('start')
  })

  it('keeps a ready flag across a pre-game reconnect', async () => {
    await createRoom('1019')
    const a = await connect('1019', 'token-a')
    expect(await a.next('joined')).toMatchObject({ seat: 'black' })
    a.ready()
    a.ws.close()
    const a2 = await connect('1019', 'token-a')
    expect(await a2.next('joined')).toMatchObject({ seat: 'black' })
    const b = await connect('1019', 'token-b')
    expect(await b.next('joined')).toMatchObject({ seat: 'white' })
    expect(await b.next('lobby')).toMatchObject({ ready: { black: true, white: false } })
    b.ready()
    await a2.next('start')
    await b.next('start')
  })

  it('rejects a third player', async () => {
    await startGame('1002')
    const res = await SELF.fetch('https://example.com/api/rooms/1002/ws?token=token-c', {
      headers: { Upgrade: 'websocket' },
    })
    expect(res.status).toBe(409)
  })

  it('reports a full room, except to already seated tokens', async () => {
    await startGame('1021')
    const stranger = await SELF.fetch('https://example.com/api/rooms/1021?token=token-x')
    expect(await stranger.json()).toEqual({ exists: true, full: true })
    const seated = await SELF.fetch('https://example.com/api/rooms/1021?token=token-a')
    expect(await seated.json()).toEqual({ exists: true, full: false })
  })

  it('settles as soon as both submit, hiding the opponent choice until then', async () => {
    const [a, b] = await startGame('1003')
    a.submit(1, { x: 6, y: 7 })
    await b.next('opponent_submitted')
    b.submit(1, { x: 8, y: 8 })
    const settled = await settledOnBoth(a, b)
    expect(cellAt(settled.state, { x: 6, y: 7 })).toBe('black')
    expect(cellAt(settled.state, { x: 8, y: 8 })).toBe('white')
    expect(settled.state.frame).toBe(2)
    expect(settled.deadline).toBeGreaterThan(Date.now())
    expect(settled.passed).toEqual([])
  })

  it('turns a collision into a forbidden point', async () => {
    const [a, b] = await startGame('1004')
    a.submit(1, { x: 6, y: 6 })
    b.submit(1, { x: 6, y: 6 })
    const settled = await settledOnBoth(a, b)
    expect(cellAt(settled.state, { x: 6, y: 6 })).toBe('forbidden')
  })

  it('treats a frame timeout without any choice as a pass', async () => {
    const [a, b] = await startGame('1005')
    a.submit(1, { x: 6, y: 7 })
    expect(await runDurableObjectAlarm(env.ROOM.get(env.ROOM.idFromName('1005')))).toBe(true)
    const settled = await settledOnBoth(a, b)
    expect(cellAt(settled.state, { x: 6, y: 7 })).toBe('black')
    expect(settled.state.board.filter((cell) => cell !== 'empty')).toHaveLength(1)
    expect(settled.passed).toEqual(['white'])
  })

  it('auto-submits an unconfirmed draft at the frame deadline', async () => {
    const [a, b] = await startGame('1012')
    a.submit(1, { x: 6, y: 6 }, false)
    a.submit(1, { x: 7, y: 6 }, false)
    a.submit(99, { x: 0, y: 0 }, false)
    expect(await a.next('error')).toMatchObject({ message: 'stale frame' })
    b.submit(1, { x: 8, y: 8 })
    await a.next('opponent_submitted')
    expect(await runDurableObjectAlarm(env.ROOM.get(env.ROOM.idFromName('1012')))).toBe(true)
    const settled = await settledOnBoth(a, b)
    expect(cellAt(settled.state, { x: 7, y: 6 })).toBe('black')
    expect(cellAt(settled.state, { x: 6, y: 6 })).toBe('empty')
    expect(cellAt(settled.state, { x: 8, y: 8 })).toBe('white')
  })

  it('keeps drafts private and does not settle early on drafts', async () => {
    const [a, b] = await startGame('1013')
    a.submit(1, { x: 6, y: 6 }, false)
    b.submit(1, { x: 8, y: 8 })
    await a.next('opponent_submitted')
    a.submit(1, { x: 7, y: 6 }, false)
    a.submit(1, { x: 7, y: 6 })
    const settled = await settledOnBoth(a, b)
    expect(cellAt(settled.state, { x: 7, y: 6 })).toBe('black')
  })

  it('rejects stale frames and illegal points', async () => {
    const [a, b] = await startGame('1006')
    a.submit(2, { x: 0, y: 0 })
    expect(await a.next('error')).toMatchObject({ message: 'stale frame' })
    b.submit(1, { x: 15, y: 0 })
    expect(await b.next('error')).toMatchObject({ message: 'illegal point' })
    b.submit(1, { x: 0, y: 0 })
    expect(await b.next('error')).toMatchObject({ message: 'illegal point' })
    b.submit(1, { x: 7, y: 7 })
    expect(await b.next('error')).toMatchObject({ message: 'illegal point' })
  })

  it('lets a player revise a submission until the opponent locks in', async () => {
    const [a, b] = await startGame('1022')
    a.submit(1, { x: 6, y: 7 })
    expect(await b.next('opponent_submitted')).toMatchObject({ submitted: true })
    a.submit(1, { x: 7, y: 6 }, false)
    expect(await b.next('opponent_submitted')).toMatchObject({ submitted: false })
    a.submit(1, { x: 7, y: 6 })
    expect(await b.next('opponent_submitted')).toMatchObject({ submitted: true })
    b.submit(1, { x: 8, y: 8 })
    const settled = await settledOnBoth(a, b)
    expect(cellAt(settled.state, { x: 7, y: 6 })).toBe('black')
    expect(cellAt(settled.state, { x: 6, y: 7 })).toBe('empty')
  })

  it('starts an untimed game with no deadline and never auto-settles', async () => {
    await createRoom('1025', 0)
    const a = await connect('1025', 'token-a')
    const b = await connect('1025', 'token-b')
    await a.next('joined')
    expect(await b.next('joined')).toMatchObject({ frameSeconds: 0 })
    a.ready()
    b.ready()
    const start = await a.next('start')
    if (start.type !== 'start') throw new Error('unreachable')
    expect(start.frameSeconds).toBe(0)
    expect(start.deadline).toBeNull()
    await b.next('start')

    a.submit(1, { x: 6, y: 7 })
    const stub = env.ROOM.get(env.ROOM.idFromName('1025'))
    await runDurableObjectAlarm(stub)
    b.submit(1, { x: 7, y: 8 })
    const settled = await a.next('frame_settled')
    if (settled.type !== 'frame_settled') throw new Error('unreachable')
    expect(settled.deadline).toBeNull()
    expect(cellAt(settled.state, { x: 6, y: 7 })).toBe('black')
    expect(cellAt(settled.state, { x: 7, y: 8 })).toBe('white')
  })

  it('awards a race-mode collision to the earlier final submission', async () => {
    await createRoom('1026', 30, 'race')
    const a = await connect('1026', 'token-a')
    const b = await connect('1026', 'token-b')
    await a.next('joined')
    await b.next('joined')
    a.ready()
    b.ready()
    await a.next('start')
    await b.next('start')

    b.submit(1, { x: 6, y: 6 })
    await a.next('opponent_submitted')
    await new Promise((resolve) => setTimeout(resolve, 5))
    a.submit(1, { x: 6, y: 6 })
    const settled = await a.next('frame_settled')
    if (settled.type !== 'frame_settled') throw new Error('unreachable')
    expect(cellAt(settled.state, { x: 6, y: 6 })).toBe('white')
  })

  it('notifies the opponent when a player leaves', async () => {
    const [a, b] = await startGame('1007')
    a.ws.close()
    await b.next('opponent_left')
  })

  it('plays to a win, then rematches through the lobby in the same room', async () => {
    const [a, b] = await startGame('1008')
    const settled = await playToBlackWin(a, b)
    expect(settled.state.phase).toBe('black_won')
    expect(settled.deadline).toBeNull()

    a.rematch()
    expect(await b.next('rematch_requested')).toMatchObject({ frameSeconds: 30, mode: 'forbidden' })
    b.rematch()
    expect(await a.next('joined')).toMatchObject({ seat: 'black', frameSeconds: 30 })
    expect(await b.next('joined')).toMatchObject({ seat: 'white', frameSeconds: 30 })
    expect(await a.next('lobby')).toMatchObject({ ready: { black: false, white: false } })
    a.ready()
    b.ready()
    const fresh = await a.next('start')
    if (fresh.type !== 'start') throw new Error('unreachable')
    expect(fresh.state.frame).toBe(1)
    expect(fresh.state.board.every((cell) => cell === 'empty')).toBe(true)
    expect(await b.next('start')).toEqual(fresh)
  })

  it('applies the proposed settings when a rematch is accepted', async () => {
    const [a, b] = await startGame('1023')
    await playToBlackWin(a, b)

    a.rematch(60, 'minus')
    expect(await b.next('rematch_requested')).toMatchObject({ frameSeconds: 60, mode: 'minus' })
    b.rematch(60, 'minus')
    expect(await a.next('joined')).toMatchObject({ seat: 'black', frameSeconds: 60, mode: 'minus' })
    await b.next('joined')
    a.ready()
    b.ready()
    const fresh = await a.next('start')
    if (fresh.type !== 'start') throw new Error('unreachable')
    expect(fresh.frameSeconds).toBe(60)
    expect(fresh.state.mode).toBe('minus')
  })

  it('treats a differing rematch proposal as a counter-offer', async () => {
    const [a, b] = await startGame('1024')
    await playToBlackWin(a, b)

    a.rematch(30, 'forbidden')
    await b.next('rematch_requested')
    b.rematch(60, 'minus')
    expect(await a.next('rematch_requested')).toMatchObject({ frameSeconds: 60, mode: 'minus' })
    a.rematch(60, 'minus')
    expect(await a.next('joined')).toMatchObject({ frameSeconds: 60, mode: 'minus' })
    await b.next('joined')
  })

  it('relays a rematch decline and allows re-inviting', async () => {
    const [a, b] = await startGame('1017')
    await playToBlackWin(a, b)

    a.rematch()
    await b.next('rematch_requested')
    b.ws.send(JSON.stringify({ type: 'rematch_decline' }))
    await a.next('rematch_declined')

    a.rematch()
    await b.next('rematch_requested')
    b.rematch()
    await a.next('joined')
    await b.next('joined')
    a.ready()
    b.ready()
    const fresh = await a.next('start')
    if (fresh.type !== 'start') throw new Error('unreachable')
    expect(fresh.state.frame).toBe(1)
  })

  it('rejects rematch while the game is in progress', async () => {
    const [a] = await startGame('1014')
    a.rematch()
    expect(await a.next('error')).toMatchObject({ message: 'game not finished' })
  })

  it('forfeits the game and closes the room on leave', async () => {
    const [a, b] = await startGame('1016')
    a.ws.send(JSON.stringify({ type: 'leave' }))
    expect(await b.next('opponent_resigned')).toEqual({ type: 'opponent_resigned', left: true })
    const settled = await b.next('frame_settled')
    if (settled.type !== 'frame_settled') throw new Error('unreachable')
    expect(settled.state.phase).toBe('white_won')
    expect(settled.deadline).toBeNull()
    expect(await b.next('room_closed')).toEqual({ type: 'room_closed' })

    const stub = env.ROOM.get(env.ROOM.idFromName('1016'))
    await vi.waitFor(async () => {
      const entries = await runInDurableObject(stub, (_instance, state) => state.storage.list())
      expect(entries.size).toBe(0)
    })
    const res = await SELF.fetch('https://example.com/api/rooms/1016/ws?token=token-c', {
      headers: { Upgrade: 'websocket' },
    })
    expect(res.status).toBe(404)
  })

  it('recycles a finished room after the last player leaves', async () => {
    const [a, b] = await startGame('1015')
    const settled = await playToBlackWin(a, b)
    expect(settled.state.phase).toBe('black_won')

    a.ws.close()
    b.ws.close()
    const stub = env.ROOM.get(env.ROOM.idFromName('1015'))
    await vi.waitFor(async () => {
      const entries = await runInDurableObject(stub, (_instance, state) => state.storage.list())
      expect(entries.size).toBe(0)
    })

    const res = await SELF.fetch('https://example.com/api/rooms/1015')
    expect(await res.json()).toEqual({ exists: false, full: false })
  })

  it('lets a player reconnect mid-game and restores the frame snapshot', async () => {
    const [a, b] = await startGame('1009')
    a.submit(1, { x: 6, y: 7 })
    await b.next('opponent_submitted')
    a.ws.close()
    await b.next('opponent_left')

    const a2 = await connect('1009', 'token-a')
    expect(await a2.next('joined')).toMatchObject({ seat: 'black' })
    const start = await a2.next('start')
    expect(start).toMatchObject({
      state: { frame: 1 },
      submitted: { black: true, white: false },
      yourChoice: { x: 6, y: 7 },
    })
    await b.next('opponent_returned')

    b.submit(1, { x: 8, y: 8 })
    const settled = await settledOnBoth(a2, b)
    expect(cellAt(settled.state, { x: 6, y: 7 })).toBe('black')
    expect(settled.state.frame).toBe(2)
  })

  it('replaces the old socket on reconnect without notifying the opponent', async () => {
    const [a, b] = await startGame('1010')
    const closed = new Promise<void>((resolve) => a.ws.addEventListener('close', () => resolve()))
    const a2 = await connect('1010', 'token-a')
    expect(await a2.next('joined')).toMatchObject({ seat: 'black' })
    await a2.next('start')
    await closed

    a2.submit(1, { x: 6, y: 6 })
    await b.next('opponent_submitted')
    b.submit(1, { x: 8, y: 8 })
    await settledOnBoth(a2, b)
  })

  it('keeps a briefly abandoned game alive and lets a player resume it', async () => {
    const [a, b] = await startGame('1011')
    a.ws.close()
    b.ws.close()
    const stub = env.ROOM.get(env.ROOM.idFromName('1011'))
    await waitForEmpty(stub)
    expect(await runDurableObjectAlarm(stub)).toBe(true)

    const res = await SELF.fetch('https://example.com/api/rooms/1011?token=token-a')
    expect(await res.json()).toEqual({ exists: true, full: false })

    const a2 = await connect('1011', 'token-a')
    expect(await a2.next('joined')).toMatchObject({ seat: 'black' })
    expect(await a2.next('start')).toMatchObject({ state: { frame: 1, phase: 'playing' } })
  })

  it('reaps an abandoned game once it has been empty past the idle TTL', async () => {
    const [a, b] = await startGame('1028')
    a.ws.close()
    b.ws.close()
    const stub = env.ROOM.get(env.ROOM.idFromName('1028'))
    await waitForEmpty(stub)
    await runInDurableObject(stub, (_instance, state) =>
      state.storage.put('emptySince', Date.now() - 11 * 60 * 1000),
    )
    expect(await runDurableObjectAlarm(stub)).toBe(true)

    const res = await SELF.fetch('https://example.com/api/rooms/1028')
    expect(await res.json()).toEqual({ exists: false, full: false })
  })

  it('restarts the frame timer when a player returns after the deadline lapsed unattended', async () => {
    const [a, b] = await startGame('1029')
    a.ws.close()
    b.ws.close()
    const stub = env.ROOM.get(env.ROOM.idFromName('1029'))
    await waitForEmpty(stub)
    await runInDurableObject(stub, (_instance, state) =>
      state.storage.put('deadline', Date.now() - 5000),
    )

    const a2 = await connect('1029', 'token-a')
    await a2.next('joined')
    const start = await a2.next('start')
    if (start.type !== 'start') throw new Error('unreachable')
    expect(start.state.frame).toBe(1)
    expect(start.deadline).toBeGreaterThan(Date.now())
  })

  it('answers a ping frame with pong without touching the message handler', async () => {
    await createRoom('1030')
    const res = await SELF.fetch('https://example.com/api/rooms/1030/ws?token=token-a', {
      headers: { Upgrade: 'websocket' },
    })
    const ws = res.webSocket!
    ws.accept()
    const messages: string[] = []
    ws.addEventListener('message', (event) => messages.push(event.data as string))
    ws.send('ping')
    await vi.waitFor(() => {
      expect(messages).toContain('pong')
    })
    expect(messages.some((raw) => raw.includes('malformed'))).toBe(false)
  })

  it('ends the game when a player resigns, keeping the room open for a rematch', async () => {
    const [a, b] = await startGame('1031')
    a.ws.send(JSON.stringify({ type: 'resign' }))
    expect(await b.next('opponent_resigned')).toEqual({ type: 'opponent_resigned', left: false })
    const settled = await settledOnBoth(a, b)
    expect(settled.state.phase).toBe('white_won')
    b.rematch()
    await a.next('rematch_requested')
  })

  it('settles a draw when the opponent accepts the offer', async () => {
    const [a, b] = await startGame('1032')
    a.ws.send(JSON.stringify({ type: 'draw_offer' }))
    await b.next('draw_offered')
    b.ws.send(JSON.stringify({ type: 'draw_response', accept: true }))
    const settled = await settledOnBoth(a, b)
    expect(settled.state.phase).toBe('draw')
  })

  it('keeps playing when the draw offer is declined', async () => {
    const [a, b] = await startGame('1033')
    a.ws.send(JSON.stringify({ type: 'draw_offer' }))
    await b.next('draw_offered')
    b.ws.send(JSON.stringify({ type: 'draw_response', accept: false }))
    await a.next('draw_declined')
    a.submit(1, { x: 6, y: 7 })
    b.submit(1, { x: 8, y: 8 })
    const settled = await settledOnBoth(a, b)
    expect(settled.state.frame).toBe(2)
  })
})

describe('account seat recovery', () => {
  async function sessionFor(email: string): Promise<string> {
    const stub = env.ACCOUNTS.get(env.ACCOUNTS.idFromName('accounts'))
    const registered = await stub.register(email)
    if (!registered.ok) throw new Error(registered.error)
    const verified = await stub.verify(email, registered.code, 'secret123')
    if (!verified.ok) throw new Error(verified.error)
    return verified.token
  }

  it('reclaims the seat from a new device via the login session', async () => {
    await createRoom('2001')
    const session = await sessionFor('seat@example.com')
    const a = await connect('2001', 'device-1', session)
    expect(await a.next('joined')).toMatchObject({ seat: 'black' })
    const b = await connect('2001', 'token-b')
    expect(await b.next('joined')).toMatchObject({ seat: 'white' })

    const closed = new Promise<{ reason: string }>((resolve) =>
      a.ws.addEventListener('close', resolve),
    )
    const a2 = await connect('2001', 'device-2', session)
    expect(await a2.next('joined')).toMatchObject({ seat: 'black' })
    expect((await closed).reason).toBe('replaced by reconnect')
  })

  it('rejects a stranger token while the account still gets in', async () => {
    await createRoom('2002')
    const session = await sessionFor('seat2@example.com')
    ;(await connect('2002', 'device-1', session)).ready()
    ;(await connect('2002', 'token-b')).ready()

    const stranger = await SELF.fetch('https://example.com/api/rooms/2002/ws?token=stranger', {
      headers: { Upgrade: 'websocket' },
    })
    expect(stranger.status).toBe(409)

    const guest = await SELF.fetch('https://example.com/api/rooms/2002?token=stranger')
    expect(await guest.json()).toEqual({ exists: true, full: true })
    const owner = await SELF.fetch(
      `https://example.com/api/rooms/2002?token=device-2&auth=${session}`,
    )
    expect(await owner.json()).toEqual({ exists: true, full: false })
  })

  it('ignores an invalid auth token and falls back to guest behavior', async () => {
    await createRoom('2003')
    const a = await connect('2003', 'token-a', 'bogus-session')
    expect(await a.next('joined')).toMatchObject({ seat: 'black' })
    const again = await connect('2003', 'token-a', 'bogus-session')
    expect(await again.next('joined')).toMatchObject({ seat: 'black' })
  })

  it('records the result for logged-in players when the game ends', async () => {
    await createRoom('2005')
    const winner = await sessionFor('winner@example.com')
    const loser = await sessionFor('loser@example.com')
    const a = await connect('2005', 'token-a', winner)
    const b = await connect('2005', 'token-b', loser)
    await a.next('joined')
    await b.next('joined')
    a.ready()
    b.ready()
    await a.next('start')
    await b.next('start')
    const settled = await playToBlackWin(a, b)
    expect(settled.state.phase).toBe('black_won')

    const stub = env.ACCOUNTS.get(env.ACCOUNTS.idFromName('accounts'))
    const emails = ['wi***@example.com', 'lo***@example.com']
    await vi.waitFor(async () => {
      const board = await stub.leaderboard()
      expect(board.filter((entry) => emails.includes(entry.email))).toEqual([
        { email: 'wi***@example.com', wins: 1, losses: 0, draws: 0 },
        { email: 'lo***@example.com', wins: 0, losses: 1, draws: 0 },
      ])
    })
  })

  it('records a resignation as a loss, skipping guest opponents', async () => {
    await createRoom('2006')
    const session = await sessionFor('quitter@example.com')
    const a = await connect('2006', 'token-a', session)
    const b = await connect('2006', 'token-b')
    await a.next('joined')
    await b.next('joined')
    a.ready()
    b.ready()
    await a.next('start')
    await b.next('start')

    a.ws.send(JSON.stringify({ type: 'leave' }))
    await b.next('room_closed')

    const stub = env.ACCOUNTS.get(env.ACCOUNTS.idFromName('accounts'))
    await vi.waitFor(async () => {
      const board = await stub.leaderboard()
      expect(board.find((entry) => entry.email === 'qu***@example.com')).toEqual({
        email: 'qu***@example.com',
        wins: 0,
        losses: 1,
        draws: 0,
      })
    })
  })

  it('broadcasts masked seat accounts, unmasked once the owner opts in', async () => {
    await createRoom('2004')
    const session = await sessionFor('info@example.com')
    const a = await connect('2004', 'device-1', session)
    expect(await a.next('players')).toEqual({
      type: 'players',
      accounts: { black: 'in***@example.com', white: null },
    })
    const b = await connect('2004', 'token-b')
    expect(await b.next('players')).toEqual({
      type: 'players',
      accounts: { black: 'in***@example.com', white: null },
    })
    expect(await a.next('players')).toEqual({
      type: 'players',
      accounts: { black: 'in***@example.com', white: null },
    })

    const stub = env.ACCOUNTS.get(env.ACCOUNTS.idFromName('accounts'))
    expect(await stub.setEmailVisible(session, 'game', true)).toBe(true)
    a.ws.send(JSON.stringify({ type: 'refresh_players' }))
    expect(await a.next('players')).toEqual({
      type: 'players',
      accounts: { black: 'info@example.com', white: null },
    })
    expect(await b.next('players')).toEqual({
      type: 'players',
      accounts: { black: 'info@example.com', white: null },
    })
  })
})
