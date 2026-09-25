import { env, runDurableObjectAlarm, SELF } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { meleeCellAt, type Color } from '@gomoku/engine/melee'
import type { Point } from '@gomoku/engine/game'
import type { MeleeServerMessage } from '@/shared/protocol'

interface Client {
  ws: WebSocket
  next<T extends MeleeServerMessage['type']>(
    type: T,
  ): Promise<Extract<MeleeServerMessage, { type: T }>>
  submit(frame: number, point: Point | null, final?: boolean): void
  ready(): void
  leave(): void
}

async function createMelee(code: string, players = 3): Promise<void> {
  const params = new URLSearchParams({ players: String(players) })
  await env.MELEE.get(env.MELEE.idFromName(code)).fetch(`https://room/create?${params}`, {
    method: 'POST',
  })
}

async function connect(code: string, key: string): Promise<Client> {
  const res = await SELF.fetch(`https://example.com/api/melee/${code}/ws?key=${key}`, {
    headers: { Upgrade: 'websocket' },
  })
  expect(res.status).toBe(101)
  const ws = res.webSocket!
  ws.accept()
  const queue: MeleeServerMessage[] = []
  const waiters: Array<() => void> = []
  ws.addEventListener('message', (event) => {
    queue.push(JSON.parse(event.data as string) as MeleeServerMessage)
    waiters.shift()?.()
  })
  return {
    ws,
    async next(type) {
      while (true) {
        const msg = queue.shift()
        if (msg?.type === type) return msg as never
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
    leave() {
      ws.send(JSON.stringify({ type: 'leave' }))
    },
  }
}

async function startGame(code: string, players = 3): Promise<Client[]> {
  await createMelee(code, players)
  const clients: Client[] = []
  for (let i = 0; i < players; i++) clients.push(await connect(code, `key-${i}`))
  for (const client of clients) client.ready()
  for (const client of clients) await client.next('start')
  return clients
}

// 开局区外的自由落点，各人错开列。
const spot = (i: number, frame: number): Point => ({ x: 2 + i * 6, y: 2 + frame })

describe('Melee', () => {
  it('seats players by color order and reports fullness', async () => {
    await createMelee('3001', 3)
    const a = await connect('3001', 'a')
    const b = await connect('3001', 'b')
    expect(await a.next('joined')).toMatchObject({
      seat: 'black',
      seats: ['black', 'white', 'purple'],
    })
    expect(await b.next('joined')).toMatchObject({ seat: 'white' })
    let status = await SELF.fetch('https://example.com/api/melee/3001?key=zzz')
    expect(await status.json()).toEqual({ exists: true, full: false })
    await connect('3001', 'c')
    status = await SELF.fetch('https://example.com/api/melee/3001?key=zzz')
    expect(await status.json()).toEqual({ exists: true, full: true })
    status = await SELF.fetch('https://example.com/api/melee/3001?key=a')
    expect(await status.json()).toEqual({ exists: true, full: false })
    const late = await SELF.fetch('https://example.com/api/melee/3001/ws?key=zzz', {
      headers: { Upgrade: 'websocket' },
    })
    expect(late.status).toBe(409)
  })

  it('starts once every seat is present and ready', async () => {
    await createMelee('3002', 3)
    const a = await connect('3002', 'a')
    const b = await connect('3002', 'b')
    a.ready()
    b.ready()
    let lobby = await b.next('lobby')
    while (lobby.ready.length < 2) lobby = await b.next('lobby')
    expect(lobby).toMatchObject({ present: ['black', 'white'], ready: ['black', 'white'] })
    const c = await connect('3002', 'c')
    c.ready()
    const start = await c.next('start')
    expect(start.state.active).toEqual(['black', 'white', 'purple'])
    expect(start.state.board).toHaveLength(19 * 19)
  })

  it('settles a frame when all active players submit and tracks submissions', async () => {
    const [a, b, c] = await startGame('3003')
    a.submit(1, { x: 9, y: 10 })
    expect(await c.next('submitted')).toMatchObject({ submitted: ['black'] })
    b.submit(1, { x: 10, y: 10 })
    c.submit(1, { x: 10, y: 9 })
    const settled = await a.next('frame_settled')
    expect(settled.state.frame).toBe(2)
    expect(meleeCellAt(settled.state, { x: 9, y: 10 })).toBe('black')
    expect(meleeCellAt(settled.state, { x: 10, y: 10 })).toBe('white')
    expect(meleeCellAt(settled.state, { x: 10, y: 9 })).toBe('purple')
  })

  it('ranks a finisher and keeps settling only on the remaining players', async () => {
    const [a, b, c] = await startGame('3004')
    a.submit(1, { x: 8, y: 9 })
    b.submit(1, { x: 10, y: 10 })
    c.submit(1, { x: 10, y: 9 })
    await a.next('frame_settled')
    for (let frame = 2; frame <= 6; frame++) {
      a.submit(frame, spot(0, frame))
      b.submit(frame, spot(1, frame))
      c.submit(frame, spot(2, frame))
      const settled = await a.next('frame_settled')
      if (frame === 6) {
        // 黑白紫三人同帧各成竖五 → 同五全消，无人完赛。
        expect(settled.state.ranking).toEqual([])
        expect(settled.state.cleared).toHaveLength(3)
      }
    }
    for (let frame = 7; frame <= 11; frame++) {
      a.submit(frame, spot(0, frame))
      b.submit(frame, null)
      c.submit(frame, null)
      const settled = await a.next('frame_settled')
      if (frame === 11) {
        expect(settled.state.ranking).toEqual(['black'])
        expect(settled.state.active).toEqual(['white', 'purple'])
        expect(settled.state.phase).toBe('playing')
      }
    }
    // 黑已完赛：后续只需白紫提交即可结算。
    b.submit(12, { x: 5, y: 18 })
    c.submit(12, { x: 6, y: 18 })
    expect((await a.next('frame_settled')).state.frame).toBe(13)
    const stale = await new Promise<MeleeServerMessage>((resolve) => {
      a.ws.addEventListener('message', (e) => resolve(JSON.parse(e.data as string)), { once: true })
      a.submit(13, { x: 7, y: 18 })
    })
    expect(stale).toMatchObject({ type: 'error', message: 'game not in progress' })
  })

  it('drops a leaver mid-game and ends when one player is left', async () => {
    const [a, b, c] = await startGame('3005')
    a.submit(1, { x: 8, y: 9 })
    b.leave()
    const dropped = await c.next('dropped')
    expect(dropped).toMatchObject({ seat: 'white' })
    expect(dropped.state.out).toEqual(['white'])
    expect(dropped.state.active).toEqual(['black', 'purple'])
    c.submit(1, { x: 10, y: 10 })
    expect((await a.next('frame_settled')).state.frame).toBe(2)
    c.leave()
    const over = await a.next('frame_settled')
    expect(over.state.phase).toBe('over')
    expect(over.state.ranking).toEqual(['black'])
    expect(over.deadline).toBeNull()
  })

  it('settles on the alarm with drafts and passes for the silent', async () => {
    const [a, b, c] = await startGame('3006')
    b.submit(1, { x: 10, y: 10 }, false)
    a.submit(1, { x: 8, y: 9 })
    await c.next('submitted')
    const stub = env.MELEE.get(env.MELEE.idFromName('3006'))
    expect(await runDurableObjectAlarm(stub)).toBe(true)
    const settled = await c.next('frame_settled')
    expect(meleeCellAt(settled.state, { x: 8, y: 9 })).toBe('black')
    expect(meleeCellAt(settled.state, { x: 10, y: 10 })).toBe('white')
    expect(settled.state.lastMoves).toHaveLength(2)
  })

  it('rejects melee creation with an invalid player count', async () => {
    const res = await SELF.fetch('https://example.com/api/melee?players=2', { method: 'POST' })
    expect(res.status).toBe(400)
    const ok = await SELF.fetch('https://example.com/api/melee?players=5', {
      method: 'POST',
    })
    expect(ok.status).toBe(200)
    const { code } = (await ok.json()) as { code: string }
    const a = await connect(code, 'a')
    expect(await a.next('joined')).toMatchObject({
      seats: ['black', 'white', 'purple', 'yellow', 'blue'] satisfies Color[],
      frameSeconds: 60,
    })
  })
})
