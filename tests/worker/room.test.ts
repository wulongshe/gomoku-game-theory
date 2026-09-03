import { env, runDurableObjectAlarm, runInDurableObject, SELF } from 'cloudflare:test'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cellAt, type Point } from '@gomoku/engine/game'
import type { ServerMessage } from '@/shared/protocol'
import { allocateRoom } from '@/worker/roomCode'

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

async function connect(code: string, key: string, auth?: string): Promise<Client> {
  const res = await SELF.fetch(
    `https://example.com/api/rooms/${code}/ws?key=${key}${auth ? `&token=${auth}` : ''}`,
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
  const a = await connect(code, 'key-a')
  const b = await connect(code, 'key-b')
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
    const res = await SELF.fetch('https://example.com/api/rooms/9099/ws?key=key-a', {
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
    const a = await connect('1018', 'key-a')
    expect(await a.next('joined')).toMatchObject({ seat: 'black' })
    a.ws.close()
    const a2 = await connect('1018', 'key-a')
    expect(await a2.next('joined')).toMatchObject({ seat: 'black' })
  })

  it('seats two players and starts once both are ready', async () => {
    await createRoom('1001')
    const a = await connect('1001', 'key-a')
    expect(await a.next('joined')).toMatchObject({ seat: 'black' })
    expect(await a.next('lobby')).toMatchObject({ present: { black: true, white: false } })
    const b = await connect('1001', 'key-b')
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
    const a = await connect('1020', 'key-a')
    const b = await connect('1020', 'key-b')
    a.ready()
    b.ready()
    const start = await a.next('start')
    if (start.type !== 'start') throw new Error('unreachable')
    expect(start.frameSeconds).toBe(60)
    expect(start.deadline).toBeGreaterThan(Date.now() + 55_000)
    await b.next('start')
  })

  it('clears a ready flag when a player leaves before the game', async () => {
    await createRoom('1019')
    const a = await connect('1019', 'key-a')
    expect(await a.next('joined')).toMatchObject({ seat: 'black' })
    a.ready()
    a.ws.close()
    await waitForEmpty(env.ROOM.get(env.ROOM.idFromName('1019')))
    const a2 = await connect('1019', 'key-a')
    expect(await a2.next('joined')).toMatchObject({ seat: 'black' })
    const b = await connect('1019', 'key-b')
    expect(await b.next('joined')).toMatchObject({ seat: 'white' })
    expect(await b.next('lobby')).toMatchObject({ ready: { black: false, white: false } })
    a2.ready()
    b.ready()
    await a2.next('start')
    await b.next('start')
  })

  it('rejects a third player', async () => {
    await startGame('1002')
    const res = await SELF.fetch('https://example.com/api/rooms/1002/ws?key=key-c', {
      headers: { Upgrade: 'websocket' },
    })
    expect(res.status).toBe(409)
  })

  it('reports a full room, except to already seated tokens', async () => {
    await startGame('1021')
    const stranger = await SELF.fetch('https://example.com/api/rooms/1021?key=key-x')
    expect(await stranger.json()).toEqual({ exists: true, full: true })
    const seated = await SELF.fetch('https://example.com/api/rooms/1021?key=key-a')
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
    const a = await connect('1025', 'key-a')
    const b = await connect('1025', 'key-b')
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
    const a = await connect('1026', 'key-a')
    const b = await connect('1026', 'key-b')
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

  it('broadcasts each settled frame with its moves for client-side logging', async () => {
    const [a, b] = await startGame('1030')
    a.submit(1, { x: 6, y: 7 })
    b.submit(1, { x: 7, y: 8 })
    const settled = await settledOnBoth(a, b)
    expect(settled.moves!.slice(0, 2)).toEqual([{ x: 6, y: 7 }, { x: 7, y: 8 }])
    expect(['black', 'white']).toContain(settled.moves![2])
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
    const res = await SELF.fetch('https://example.com/api/rooms/1016/ws?key=key-c', {
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

    const a2 = await connect('1009', 'key-a')
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
    const a2 = await connect('1010', 'key-a')
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

    const res = await SELF.fetch('https://example.com/api/rooms/1011?key=key-a')
    expect(await res.json()).toEqual({ exists: true, full: false })

    const a2 = await connect('1011', 'key-a')
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

    const a2 = await connect('1029', 'key-a')
    await a2.next('joined')
    const start = await a2.next('start')
    if (start.type !== 'start') throw new Error('unreachable')
    expect(start.state.frame).toBe(1)
    expect(start.deadline).toBeGreaterThan(Date.now())
  })

  it('answers a ping frame with pong without touching the message handler', async () => {
    await createRoom('1030')
    const res = await SELF.fetch('https://example.com/api/rooms/1030/ws?key=key-a', {
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

async function sessionFor(email: string): Promise<string> {
  const stub = env.ACCOUNTS.get(env.ACCOUNTS.idFromName('accounts'))
  const registered = await stub.register(email)
  if (!registered.ok) throw new Error(registered.error)
  const verified = await stub.verify(email, registered.code, 'secret123')
  if (!verified.ok) throw new Error(verified.error)
  return verified.token
}

describe('account seat recovery', () => {
  it('reports a tournament result by the room winner and skips normal stats', async () => {
    const xEmail = 'tourn-x@example.com'
    const yEmail = 'tourn-y@example.com'
    const x = await sessionFor(xEmail)
    const y = await sessionFor(yEmail)
    const code = await allocateRoom(env, 15, 'forbidden', {
      tournament: { round: 1, players: [xEmail, yEmail] },
    })

    const tstub = env.TOURNAMENT.get(env.TOURNAMENT.idFromName('daily'))
    await runInDurableObject(tstub, (_i, state) =>
      state.storage.put('t', {
        state: 'active',
        round: 1,
        totalRounds: 2,
        roundDeadline: Date.now() + 600_000,
        registrations: [],
        players: {
          [xEmail]: { score: 0, opponents: [yEmail], byes: 0 },
          [yEmail]: { score: 0, opponents: [xEmail], byes: 0 },
        },
        pairings: [{ code, players: [xEmail, yEmail], checkedIn: [], result: null }],
        lastStandings: [],
      }),
    )

    // 非参赛账号无法占座（防串场/抢座）。
    const z = await sessionFor('tourn-z@example.com')
    const stranger = await SELF.fetch(
      `https://example.com/api/rooms/${code}/ws?key=tok-z&token=${z}`,
      { headers: { Upgrade: 'websocket' } },
    )
    expect(stranger.status).toBe(403)

    // 让大赛 players[0]=X 后连接：房间黑座落到 Y、白座落到 X（座位颜色与大赛无关）。
    const b = await connect(code, 'tok-y', y)
    expect(await b.next('joined')).toMatchObject({ seat: 'black', tournament: true })
    const a = await connect(code, 'tok-x', x)
    expect(await a.next('joined')).toMatchObject({ seat: 'white', tournament: true })
    b.ready()
    a.ready()
    const start = await b.next('start')
    if (start.type !== 'start') throw new Error('unreachable')
    // 大赛对局逐帧变时限：首帧 10s，而非建房时的固定 15s。
    expect(start.deadline).not.toBeNull()
    expect(start.deadline! - Date.now()).toBeLessThanOrEqual(10_000)
    await a.next('start')
    const settled = await playToBlackWin(b, a)
    expect(settled.state.phase).toBe('black_won')

    // 分记给房间赢家 Y（players[1]），而非大赛 players[0]=X。
    await vi.waitFor(async () => {
      const s = (await runInDurableObject(tstub, (_i, st) => st.storage.get('t'))) as {
        players: Record<string, { score: number }>
      }
      expect(s.players[yEmail].score).toBe(1)
      expect(s.players[xEmail].score).toBe(0)
    })

    // 大赛对局不计入普通战绩/ELO。
    const accounts = env.ACCOUNTS.get(env.ACCOUNTS.idFromName('accounts'))
    expect(await runInDurableObject(accounts, (_i, st) => st.storage.get(`stats:${xEmail}`))).toBeUndefined()
    expect(await runInDurableObject(accounts, (_i, st) => st.storage.get(`stats:${yEmail}`))).toBeUndefined()
  })

  it('reclaims the seat from a new device via the login session', async () => {
    await createRoom('2001')
    const session = await sessionFor('seat@example.com')
    const a = await connect('2001', 'device-1', session)
    expect(await a.next('joined')).toMatchObject({ seat: 'black' })
    const b = await connect('2001', 'key-b')
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
    ;(await connect('2002', 'key-b')).ready()

    const stranger = await SELF.fetch('https://example.com/api/rooms/2002/ws?key=stranger', {
      headers: { Upgrade: 'websocket' },
    })
    expect(stranger.status).toBe(409)

    const guest = await SELF.fetch('https://example.com/api/rooms/2002?key=stranger')
    expect(await guest.json()).toEqual({ exists: true, full: true })
    const owner = await SELF.fetch(
      `https://example.com/api/rooms/2002?key=device-2&token=${session}`,
    )
    expect(await owner.json()).toEqual({ exists: true, full: false })
  })

  it('ignores an invalid auth token and falls back to guest behavior', async () => {
    await createRoom('2003')
    const a = await connect('2003', 'key-a', 'bogus-session')
    expect(await a.next('joined')).toMatchObject({ seat: 'black' })
    const again = await connect('2003', 'key-a', 'bogus-session')
    expect(await again.next('joined')).toMatchObject({ seat: 'black' })
  })

  it('records the result for logged-in players when the game ends', async () => {
    await createRoom('2005')
    const winner = await sessionFor('winner@example.com')
    const loser = await sessionFor('loser@example.com')
    const a = await connect('2005', 'key-a', winner)
    const b = await connect('2005', 'key-b', loser)
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
      expect(board.entries.filter((entry) => emails.includes(entry.email))).toEqual([
        { email: 'wi***@example.com', wins: 1, losses: 0, draws: 0 },
        { email: 'lo***@example.com', wins: 0, losses: 1, draws: 0 },
      ])
    })
  })

  it('records a resignation as a loss, skipping guest opponents', async () => {
    await createRoom('2006')
    const session = await sessionFor('quitter@example.com')
    const a = await connect('2006', 'key-a', session)
    const b = await connect('2006', 'key-b')
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
      expect(board.entries.find((entry) => entry.email === 'qu***@example.com')).toEqual({
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
    const b = await connect('2004', 'key-b')
    expect(await b.next('players')).toEqual({
      type: 'players',
      accounts: { black: 'in***@example.com', white: null },
    })
    expect(await a.next('players')).toEqual({
      type: 'players',
      accounts: { black: 'in***@example.com', white: null },
    })

    const stub = env.ACCOUNTS.get(env.ACCOUNTS.idFromName('accounts'))
    expect(await stub.setEmailVisible(session, true)).toBe(true)
    // 开关全局生效，重进房后按新可见性广播。
    const a2 = await connect('2004', 'device-1', session)
    expect(await a2.next('players')).toEqual({
      type: 'players',
      accounts: { black: 'info@example.com', white: null },
    })
    expect(await b.next('players')).toEqual({
      type: 'players',
      accounts: { black: 'info@example.com', white: null },
    })
  })
})

const stubOf = (code: string) => env.ROOM.get(env.ROOM.idFromName(code))

async function aiSeatOf(code: string): Promise<'black' | 'white'> {
  const seats = await runInDurableObject(stubOf(code), async (_i, state) =>
    Object.keys((await state.storage.get<Record<string, unknown>>('aiSeats')) ?? {}),
  )
  if (!seats.length) throw new Error('missing ai seat')
  return seats[0] as 'black' | 'white'
}

// 把 AI 的进场/行动时点拨到过去再敲响闹钟，等价于现实中延时到点。
// 对局中只催还没定稿的席位（闹钟一次只行动一个席位，定稿席位会白耗一响）。
async function fireAi(code: string): Promise<void> {
  await runInDurableObject(stubOf(code), async (_i, state) => {
    const seats = Object.keys((await state.storage.get<Record<string, unknown>>('aiSeats')) ?? {})
    if (!(await state.storage.get('game'))) {
      await state.storage.put('aiArrive', Object.fromEntries(seats.map((s) => [s, Date.now() - 1])))
      return
    }
    const choices =
      ((await state.storage.get('choices')) as Record<string, { final?: boolean }> | undefined) ?? {}
    const idle = seats.filter((s) => !choices[s]?.final)
    await state.storage.put('aiPlan', Object.fromEntries(idle.map((s) => [s, Date.now() - 1])))
  })
  expect(await runDurableObjectAlarm(stubOf(code))).toBe(true)
}

describe('AI stand-in room', () => {
  afterEach(() => vi.restoreAllMocks())

  async function createAiRoom(code: string, frame = 30, mode = 'forbidden'): Promise<void> {
    await stubOf(code).fetch(`https://room/create?frame=${frame}&mode=${mode}&ai=1&matched=1`, {
      method: 'POST',
    })
  }

  it('seats the human opposite the AI and keeps a second human out', async () => {
    await createAiRoom('7101')
    const aiSeat = await aiSeatOf('7101')
    const human = await connect('7101', 'key-h')
    expect(await human.next('joined')).toMatchObject({
      seat: aiSeat === 'black' ? 'white' : 'black',
    })
    const lobby = await human.next('lobby')
    if (lobby.type !== 'lobby') throw new Error('unreachable')
    expect(lobby.present[aiSeat]).toBe(true)

    const stranger = await SELF.fetch('https://example.com/api/rooms/7101/ws?key=key-x', {
      headers: { Upgrade: 'websocket' },
    })
    expect(stranger.status).toBe(409)
  })

  // 不强拨时点：真人进房并准备后，AI 应靠自己的进场闹钟就位并开局（TODO 报过「匹配到后 AI 不准备」）。
  it('readies up on its own arrival alarm after the human readies', { timeout: 15_000 }, async () => {
    await createAiRoom('7104')
    const human = await connect('7104', 'key-h')
    await human.next('joined')
    human.ready()
    await human.next('start')
  })

  // 线上闹钟可能比预定时点早几毫秒调起；早到的闹钟也必须把进场当作到点处理，
  // 否则行动点被孤儿化（线上实证的「匹配到 AI 后不准备」）。
  it('tolerates an alarm firing slightly ahead of the AI schedule', async () => {
    await createAiRoom('7105')
    const human = await connect('7105', 'key-h')
    await human.next('joined')
    human.ready()
    await runInDurableObject(stubOf('7105'), async (_i, state) => {
      const seats = Object.keys((await state.storage.get<Record<string, unknown>>('aiSeats')) ?? {})
      await state.storage.put(
        'aiArrive',
        Object.fromEntries(seats.map((s) => [s, Date.now() + 1000])),
      )
    })
    expect(await runDurableObjectAlarm(stubOf('7105'))).toBe(true)
    await human.next('start')
  })

  it('readies up, submits a move, and settles the frame', async () => {
    // 压低随机数走「笃定直接提交」分支，避免草稿-定稿节奏引入的不确定性。
    vi.spyOn(Math, 'random').mockReturnValue(0.1)
    await createAiRoom('7102')
    const human = await connect('7102', 'key-h')
    await human.next('joined')
    human.ready()
    await fireAi('7102')
    await human.next('start')

    await fireAi('7102')
    await human.next('opponent_submitted')
    human.submit(1, { x: 6, y: 6 })
    const settled = await human.next('frame_settled')
    if (settled.type !== 'frame_settled') throw new Error('unreachable')
    expect(settled.state.frame).toBe(2)
    expect(settled.state.phase).toBe('playing')
  })

  it('declines a draw offer, credits the human loss, and accepts a rematch', async () => {
    await createAiRoom('7103')
    const session = await sessionFor('stealth@example.com')
    const human = await connect('7103', 'key-h', session)
    const joined = await human.next('joined')
    human.ready()
    await fireAi('7103')
    await human.next('start')

    human.ws.send(JSON.stringify({ type: 'draw_offer' }))
    await fireAi('7103')
    await human.next('draw_declined')

    human.ws.send(JSON.stringify({ type: 'resign' }))
    const settled = await human.next('frame_settled')
    if (settled.type !== 'frame_settled') throw new Error('unreachable')
    expect(settled.state.phase).toBe(`${await aiSeatOf('7103')}_won`)

    // 匹配来的 AI 顶替局照记战绩，ELO 按默认分虚拟对手单边结算。
    const accounts = env.ACCOUNTS.get(env.ACCOUNTS.idFromName('accounts'))
    expect(
      await runInDurableObject(accounts, (_i, st) => st.storage.get('stats:stealth@example.com')),
    ).toEqual({ wins: 0, losses: 1, draws: 0, rating: 1180 })

    human.rematch()
    await fireAi('7103')
    expect(await human.next('joined')).toMatchObject({ seat: joined.type === 'joined' ? joined.seat : undefined })
    await human.next('lobby')
  })
})

describe('tournament spectating', () => {
  async function seedSpectatableTournament(viewerEmail: string, done: boolean): Promise<void> {
    const tstub = env.TOURNAMENT.get(env.TOURNAMENT.idFromName('daily'))
    await runInDurableObject(tstub, (_i, state) =>
      state.storage.put('t', {
        state: 'active',
        startedAt: Date.now(),
        round: 1,
        totalRounds: 1,
        roundDeadline: Date.now() + 600_000,
        registrations: [],
        players: {
          [viewerEmail]: { score: 0, opponents: ['b@x'], byes: 0 },
          'b@x': { score: 0, opponents: [viewerEmail], byes: 0 },
          'c@x': { score: 0, opponents: ['d@x'], byes: 0 },
          'd@x': { score: 0, opponents: ['c@x'], byes: 0 },
        },
        pairings: [
          {
            code: '8801',
            players: [viewerEmail, 'b@x'],
            checkedIn: [viewerEmail, 'b@x'],
            result: done ? 'a' : null,
          },
          { code: '8802', players: ['c@x', 'd@x'], checkedIn: ['c@x', 'd@x'], result: null },
        ],
        past: [],
        lastStandings: [],
      }),
    )
  }

  async function connectSpectator(code: string, auth: string): Promise<Response> {
    return SELF.fetch(`https://example.com/api/rooms/${code}/ws?spectate=1&token=${auth}`, {
      headers: { Upgrade: 'websocket' },
    })
  }

  it('hides in-frame choices from spectators until the frame settles', async () => {
    const viewer = 'viewer@example.com'
    const token = await sessionFor(viewer)
    await seedSpectatableTournament(viewer, true)
    const code = await allocateRoom(env, 30, 'forbidden', {
      tournament: { round: 1, players: ['c@x', 'd@x'] },
    })
    const cToken = await sessionFor('c@x')
    const dToken = await sessionFor('d@x')
    const a = await connect(code, 'key-c', cToken)
    const b = await connect(code, 'key-d', dToken)
    await a.next('joined')
    await b.next('joined')
    a.ready()
    b.ready()
    await a.next('start')
    await b.next('start')

    const res = await connectSpectator(code, token)
    expect(res.status).toBe(101)
    const ws = res.webSocket!
    ws.accept()
    const queue: ServerMessage[] = []
    const seenTypes: string[] = []
    const waiters: Array<() => void> = []
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data as string) as ServerMessage
      queue.push(msg)
      seenTypes.push(msg.type)
      waiters.shift()?.()
    })
    const next = async (type: ServerMessage['type']) => {
      while (true) {
        const msg = queue.shift()
        if (msg?.type === type) return msg
        if (!msg) await new Promise<void>((resolve) => waiters.push(resolve))
      }
    }

    expect(await next('joined')).toMatchObject({ tournament: true, spectator: true })
    await next('start')

    // 黑方草稿、白方提交同一点：帧内不向观战者透出任何选点（防多号传点）。
    a.submit(1, { x: 6, y: 7 }, false)
    b.submit(1, { x: 6, y: 7 })
    await next('opponent_submitted')

    // 黑方也提交 → 结算，撞子成禁点此刻才可见。
    a.submit(1, { x: 6, y: 7 })
    const settled = await next('frame_settled')
    if (settled.type !== 'frame_settled') throw new Error('unreachable')
    expect(cellAt(settled.state, { x: 6, y: 7 })).toBe('forbidden')
    expect(seenTypes).not.toContain('choices')
  })

  it('rejects spectators whose own game is unfinished and guests', async () => {
    const viewer = 'busyviewer@example.com'
    const token = await sessionFor(viewer)
    await seedSpectatableTournament(viewer, false)
    const code = await allocateRoom(env, 30, 'forbidden', {
      tournament: { round: 1, players: ['c@x', 'd@x'] },
    })
    expect((await connectSpectator(code, token)).status).toBe(403)
    const guest = await SELF.fetch(`https://example.com/api/rooms/${code}/ws?spectate=1`, {
      headers: { Upgrade: 'websocket' },
    })
    expect(guest.status).toBe(403)
  })
})

describe('tournament bot rooms', () => {
  afterEach(() => vi.restoreAllMocks())
  const tstub = () => env.TOURNAMENT.get(env.TOURNAMENT.idFromName('daily'))

  interface TPairing {
    code: string | null
    players: [string, string | null]
    checkedIn: string[]
    result: string | null
  }

  async function seedTournament(
    players: Record<string, { score: number; opponents: string[]; byes: number }>,
    pairings: TPairing[],
  ): Promise<void> {
    await runInDurableObject(tstub(), (_i, state) =>
      state.storage.put('t', {
        state: 'active',
        startedAt: Date.now(),
        round: 1,
        totalRounds: 1,
        roundDeadline: Date.now() + 600_000,
        registrations: [],
        players,
        bots: {},
        pairings,
        past: [],
        lastStandings: [],
      }),
    )
  }

  const readT = () =>
    runInDurableObject(tstub(), (_i, state) =>
      state.storage.get('t'),
    ) as Promise<{ state: string; pairings: TPairing[]; past: TPairing[][] }>

  it('checks the bot in, plays human vs bot, and reports the result by bot email', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.1)
    const human = 'tb-human@example.com'
    const bot = 'tb-bot@example.com'
    const code = await allocateRoom(env, 30, 'forbidden', {
      tournament: { round: 1, players: [bot, human], bots: ['normal', null] },
    })
    await seedTournament(
      {
        [bot]: { score: 0, opponents: [human], byes: 0 },
        [human]: { score: 0, opponents: [bot], byes: 0 },
      },
      [{ code, players: [bot, human], checkedIn: [], result: null }],
    )

    // bot 到点进场 → 向大赛 check-in
    await fireAi(code)
    expect((await readT()).pairings[0].checkedIn).toContain(bot)

    const token = await sessionFor(human)
    const h = await connect(code, 'key-h', token)
    await h.next('joined')
    h.ready()
    await h.next('start')

    // 真人认输 → 赢家按 bot 的参赛邮箱上报（bot 是 players[0] → 'a'）
    h.ws.send(JSON.stringify({ type: 'resign' }))
    await h.next('frame_settled')
    const t = await readT()
    expect(t.state).toBe('idle') // 唯一一轮唯一一局出结果 → 收轮收赛
    expect(t.past[0][0].result).toBe('a')

    // 不入普通战绩
    const accounts = env.ACCOUNTS.get(env.ACCOUNTS.idFromName('accounts'))
    expect(
      await runInDurableObject(accounts, (_i, st) => st.storage.get(`stats:${human}`)),
    ).toBeUndefined()
  })

  it('plays bot vs bot unattended and streams identities and choices to spectators', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.1)
    const viewer = 'botwatcher@example.com'
    const token = await sessionFor(viewer)
    const b0 = 'tb-b0@example.com'
    const b1 = 'tb-b1@example.com'
    const code = await allocateRoom(env, 30, 'forbidden', {
      tournament: { round: 1, players: [b0, b1], bots: ['normal', 'easy'] },
    })
    await seedTournament(
      {
        [viewer]: { score: 1, opponents: ['x@x'], byes: 0 },
        'x@x': { score: 0, opponents: [viewer], byes: 0 },
        [b0]: { score: 0, opponents: [b1], byes: 0 },
        [b1]: { score: 0, opponents: [b0], byes: 0 },
      },
      [
        { code: '9901', players: [viewer, 'x@x'], checkedIn: [viewer, 'x@x'], result: 'a' },
        { code, players: [b0, b1], checkedIn: [], result: null },
      ],
    )

    // 双方 bot 到点进场：check-in 齐 → 无人连接也自动开局
    await fireAi(code)
    expect((await readT()).pairings[1].checkedIn).toEqual(expect.arrayContaining([b0, b1]))
    const game = await runInDurableObject(stubOf(code), (_i, st) => st.storage.get('game'))
    expect(game).toMatchObject({ frame: 1, phase: 'playing' })

    // 观战者能看到双方（脱敏的）参赛身份
    const res = await SELF.fetch(
      `https://example.com/api/rooms/${code}/ws?spectate=1&token=${token}`,
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
    const next = async (type: ServerMessage['type']) => {
      while (true) {
        const msg = queue.shift()
        if (msg?.type === type) return msg
        if (!msg) await new Promise<void>((resolve) => waiters.push(resolve))
      }
    }
    const players = await next('players')
    if (players.type !== 'players') throw new Error('unreachable')
    expect(players.accounts.black).toBeTruthy()
    expect(players.accounts.white).toBeTruthy()

    // 两个席位先后行动 → 双方提交 → 帧自行结算
    await fireAi(code)
    await fireAi(code)
    const settled = await next('frame_settled')
    if (settled.type !== 'frame_settled') throw new Error('unreachable')
    expect(settled.state.frame).toBe(2)
    expect(settled.state.phase).toBe('playing')
  })

  // 不用 fireAi 强拨时点，验证真实的闹钟链路（进场 → 开局 → 落子 → 结算）会自续，
  // 掉链子在线上表现为 bot 局整轮卡死判平。
  it('advances a bot vs bot game on its own alarms', { timeout: 30_000 }, async () => {
    const b0 = 'tb-auto0@example.com'
    const b1 = 'tb-auto1@example.com'
    const code = await allocateRoom(env, 30, 'forbidden', {
      tournament: { round: 1, players: [b0, b1], bots: ['easy', 'easy'] },
    })
    await seedTournament(
      {
        [b0]: { score: 0, opponents: [b1], byes: 0 },
        [b1]: { score: 0, opponents: [b0], byes: 0 },
      },
      [{ code, players: [b0, b1], checkedIn: [], result: null }],
    )
    // 只把进场时点提前，其后全靠房间自己挂的闹钟推进
    await runInDurableObject(stubOf(code), async (_i, state) => {
      const seats = Object.keys((await state.storage.get<Record<string, unknown>>('aiSeats')) ?? {})
      await state.storage.put(
        'aiArrive',
        Object.fromEntries(seats.map((s) => [s, Date.now() + 50])),
      )
      await state.storage.setAlarm(Date.now() + 50)
    })
    await vi.waitFor(
      async () => {
        const game = (await runInDurableObject(stubOf(code), (_i, st) =>
          st.storage.get('game'),
        )) as { frame: number } | undefined
        expect(game?.frame ?? 0).toBeGreaterThanOrEqual(2)
      },
      { timeout: 25_000, interval: 500 },
    )
  })
})
