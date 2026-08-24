import { env, runDurableObjectAlarm, runInDurableObject, SELF } from 'cloudflare:test'
import { describe, expect, it, vi } from 'vitest'
import { cellAt, type Point } from '@/engine/game'
import type { ServerMessage } from '@/shared/protocol'

interface Client {
  ws: WebSocket
  next(type: ServerMessage['type']): Promise<ServerMessage>
  submit(frame: number, point: Point | null, final?: boolean): void
  rematch(): void
}

async function connect(code: string, token: string): Promise<Client> {
  const res = await SELF.fetch(`https://example.com/api/rooms/${code}/ws?token=${token}`, {
    headers: { Upgrade: 'websocket' },
  })
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
    rematch() {
      ws.send(JSON.stringify({ type: 'rematch' }))
    },
  }
}

async function startGame(code: string): Promise<[Client, Client]> {
  const a = await connect(code, 'token-a')
  const b = await connect(code, 'token-b')
  expect(await a.next('joined')).toMatchObject({ seat: 'p1' })
  expect(await b.next('joined')).toMatchObject({ seat: 'p2' })
  await a.next('start')
  await b.next('start')
  return [a, b]
}

async function settledOnBoth(a: Client, b: Client) {
  const settled = await a.next('frame_settled')
  expect(await b.next('frame_settled')).toEqual(settled)
  if (settled.type !== 'frame_settled') throw new Error('unreachable')
  return settled
}

describe('Room', () => {
  it('seats two players and starts the game', async () => {
    const a = await connect('ROOM01', 'token-a')
    expect(await a.next('joined')).toMatchObject({ seat: 'p1' })
    const b = await connect('ROOM01', 'token-b')
    const start = await a.next('start')
    expect(start).toMatchObject({
      state: { frame: 1, phase: 'playing' },
      submitted: { p1: false, p2: false },
      yourChoice: null,
    })
    expect(await b.next('start')).toEqual(start)
  })

  it('rejects a third player', async () => {
    await startGame('ROOM02')
    const res = await SELF.fetch('https://example.com/api/rooms/ROOM02/ws?token=token-c', {
      headers: { Upgrade: 'websocket' },
    })
    expect(res.status).toBe(409)
  })

  it('settles as soon as both submit, hiding the opponent choice until then', async () => {
    const [a, b] = await startGame('ROOM03')
    a.submit(1, { x: 7, y: 7 })
    await b.next('opponent_submitted')
    b.submit(1, { x: 8, y: 8 })
    const settled = await settledOnBoth(a, b)
    expect(cellAt(settled.state, { x: 7, y: 7 })).toBe('p1')
    expect(cellAt(settled.state, { x: 8, y: 8 })).toBe('p2')
    expect(settled.state.frame).toBe(2)
    expect(settled.deadline).toBeGreaterThan(Date.now())
  })

  it('turns a collision into a forbidden point', async () => {
    const [a, b] = await startGame('ROOM04')
    a.submit(1, { x: 7, y: 7 })
    b.submit(1, { x: 7, y: 7 })
    const settled = await settledOnBoth(a, b)
    expect(cellAt(settled.state, { x: 7, y: 7 })).toBe('forbidden')
  })

  it('treats a frame timeout without any choice as a pass', async () => {
    const [a, b] = await startGame('ROOM05')
    a.submit(1, { x: 7, y: 7 })
    expect(await runDurableObjectAlarm(env.ROOM.get(env.ROOM.idFromName('ROOM05')))).toBe(true)
    const settled = await settledOnBoth(a, b)
    expect(cellAt(settled.state, { x: 7, y: 7 })).toBe('p1')
    expect(settled.state.board.filter((cell) => cell !== 'empty')).toHaveLength(1)
  })

  it('auto-submits an unconfirmed draft at the frame deadline', async () => {
    const [a, b] = await startGame('ROOM12')
    a.submit(1, { x: 2, y: 2 }, false)
    a.submit(1, { x: 5, y: 5 }, false)
    a.submit(99, { x: 0, y: 0 }, false)
    expect(await a.next('error')).toMatchObject({ message: 'stale frame' })
    b.submit(1, { x: 9, y: 9 })
    await a.next('opponent_submitted')
    expect(await runDurableObjectAlarm(env.ROOM.get(env.ROOM.idFromName('ROOM12')))).toBe(true)
    const settled = await settledOnBoth(a, b)
    expect(cellAt(settled.state, { x: 5, y: 5 })).toBe('p1')
    expect(cellAt(settled.state, { x: 2, y: 2 })).toBe('empty')
    expect(cellAt(settled.state, { x: 9, y: 9 })).toBe('p2')
  })

  it('keeps drafts private and does not settle early on drafts', async () => {
    const [a, b] = await startGame('ROOM13')
    a.submit(1, { x: 2, y: 2 }, false)
    b.submit(1, { x: 9, y: 9 })
    await a.next('opponent_submitted')
    a.submit(1, { x: 3, y: 3 }, false)
    a.submit(1, { x: 3, y: 3 })
    const settled = await settledOnBoth(a, b)
    expect(cellAt(settled.state, { x: 3, y: 3 })).toBe('p1')
  })

  it('rejects stale frames, double submits, and illegal points', async () => {
    const [a, b] = await startGame('ROOM06')
    a.submit(2, { x: 0, y: 0 })
    expect(await a.next('error')).toMatchObject({ message: 'stale frame' })
    a.submit(1, { x: 0, y: 0 })
    a.submit(1, { x: 1, y: 0 })
    expect(await a.next('error')).toMatchObject({ message: 'already submitted' })
    b.submit(1, { x: 15, y: 0 })
    expect(await b.next('error')).toMatchObject({ message: 'illegal point' })
  })

  it('notifies the opponent when a player leaves', async () => {
    const [a, b] = await startGame('ROOM07')
    a.ws.close()
    await b.next('opponent_left')
  })

  it('plays to a win, then rematches in the same room', async () => {
    const [a, b] = await startGame('ROOM08')
    for (let i = 0; i < 4; i++) {
      a.submit(i + 1, { x: i, y: 0 })
      b.submit(i + 1, { x: i, y: 7 + (i % 2) })
      await settledOnBoth(a, b)
    }
    a.submit(5, { x: 4, y: 0 })
    b.submit(5, { x: 4, y: 7 })
    const settled = await settledOnBoth(a, b)
    expect(settled.state.phase).toBe('p1_won')
    expect(settled.deadline).toBeNull()

    a.rematch()
    expect(await b.next('rematch_requested')).toBeTruthy()
    b.rematch()
    const fresh = await a.next('start')
    if (fresh.type !== 'start') throw new Error('unreachable')
    expect(fresh.state.frame).toBe(1)
    expect(fresh.state.board.every((cell) => cell === 'empty')).toBe(true)
    expect(await b.next('start')).toEqual(fresh)
  })

  it('relays a rematch decline and allows re-inviting', async () => {
    const [a, b] = await startGame('ROOM17')
    for (let i = 0; i < 4; i++) {
      a.submit(i + 1, { x: i, y: 0 })
      b.submit(i + 1, { x: i, y: 7 + (i % 2) })
      await settledOnBoth(a, b)
    }
    a.submit(5, { x: 4, y: 0 })
    b.submit(5, { x: 4, y: 7 })
    await settledOnBoth(a, b)

    a.rematch()
    await b.next('rematch_requested')
    b.ws.send(JSON.stringify({ type: 'rematch_decline' }))
    await a.next('rematch_declined')

    a.rematch()
    await b.next('rematch_requested')
    b.rematch()
    const fresh = await a.next('start')
    if (fresh.type !== 'start') throw new Error('unreachable')
    expect(fresh.state.frame).toBe(1)
  })

  it('rejects rematch while the game is in progress', async () => {
    const [a] = await startGame('ROOM14')
    a.rematch()
    expect(await a.next('error')).toMatchObject({ message: 'game not finished' })
  })

  it('forfeits the game and closes the room on leave', async () => {
    const [a, b] = await startGame('ROOM16')
    a.ws.send(JSON.stringify({ type: 'leave' }))
    const settled = await b.next('frame_settled')
    if (settled.type !== 'frame_settled') throw new Error('unreachable')
    expect(settled.state.phase).toBe('p2_won')
    expect(settled.deadline).toBeNull()

    const stub = env.ROOM.get(env.ROOM.idFromName('ROOM16'))
    await vi.waitFor(async () => {
      const entries = await runInDurableObject(stub, (_instance, state) => state.storage.list())
      expect(entries.size).toBe(0)
    })
    const c = await connect('ROOM16', 'token-c')
    expect(await c.next('joined')).toMatchObject({ seat: 'p1' })
  })

  it('recycles a finished room after the last player leaves', async () => {
    const [a, b] = await startGame('ROOM15')
    for (let i = 0; i < 4; i++) {
      a.submit(i + 1, { x: i, y: 0 })
      b.submit(i + 1, { x: i, y: 7 + (i % 2) })
      await settledOnBoth(a, b)
    }
    a.submit(5, { x: 4, y: 0 })
    b.submit(5, { x: 4, y: 7 })
    const settled = await settledOnBoth(a, b)
    expect(settled.state.phase).toBe('p1_won')

    a.ws.close()
    b.ws.close()
    const stub = env.ROOM.get(env.ROOM.idFromName('ROOM15'))
    await vi.waitFor(async () => {
      const entries = await runInDurableObject(stub, (_instance, state) => state.storage.list())
      expect(entries.size).toBe(0)
    })

    const c = await connect('ROOM15', 'token-c')
    expect(await c.next('joined')).toMatchObject({ seat: 'p1' })
  })

  it('lets a player reconnect mid-game and restores the frame snapshot', async () => {
    const [a, b] = await startGame('ROOM09')
    a.submit(1, { x: 3, y: 4 })
    await b.next('opponent_submitted')
    a.ws.close()
    await b.next('opponent_left')

    const a2 = await connect('ROOM09', 'token-a')
    expect(await a2.next('joined')).toMatchObject({ seat: 'p1' })
    const start = await a2.next('start')
    expect(start).toMatchObject({
      state: { frame: 1 },
      submitted: { p1: true, p2: false },
      yourChoice: { x: 3, y: 4 },
    })
    await b.next('opponent_returned')

    b.submit(1, { x: 8, y: 8 })
    const settled = await settledOnBoth(a2, b)
    expect(cellAt(settled.state, { x: 3, y: 4 })).toBe('p1')
    expect(settled.state.frame).toBe(2)
  })

  it('replaces the old socket on reconnect without notifying the opponent', async () => {
    const [a, b] = await startGame('ROOM10')
    const closed = new Promise<void>((resolve) => a.ws.addEventListener('close', () => resolve()))
    const a2 = await connect('ROOM10', 'token-a')
    expect(await a2.next('joined')).toMatchObject({ seat: 'p1' })
    await a2.next('start')
    await closed

    a2.submit(1, { x: 0, y: 0 })
    await b.next('opponent_submitted')
    b.submit(1, { x: 1, y: 1 })
    await settledOnBoth(a2, b)
  })

  it('cleans up an abandoned game at the next alarm', async () => {
    const [a, b] = await startGame('ROOM11')
    a.ws.close()
    b.ws.close()
    expect(await runDurableObjectAlarm(env.ROOM.get(env.ROOM.idFromName('ROOM11')))).toBe(true)

    const c = await connect('ROOM11', 'token-c')
    expect(await c.next('joined')).toMatchObject({ seat: 'p1' })
  })
})
