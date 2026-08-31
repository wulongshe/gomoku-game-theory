import { env, runDurableObjectAlarm, runInDurableObject, SELF } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { nextDailyStart, pairRound, type SwissPlayer } from '@/worker/tournament'

const NEUTRAL = () => 0.5

function player(email: string, over: Partial<SwissPlayer> = {}): SwissPlayer {
  return { email, score: 0, opponents: [], byes: 0, ...over }
}

interface TState {
  state: string
  round: number
  totalRounds: number
  roundDeadline: number | null
  registrations: string[]
  players: Record<string, { score: number; opponents: string[]; byes: number }>
  pairings: Array<{
    code: string | null
    players: [string, string | null]
    checkedIn: string[]
    result: string | null
  }>
  past: Array<
    Array<{
      code: string | null
      players: [string, string | null]
      checkedIn: string[]
      result: string | null
    }>
  >
  lastStandings: Array<{ email: string; score: number; played: number }>
}

function stub() {
  return env.TOURNAMENT.get(env.TOURNAMENT.idFromName('daily'))
}

function full(partial: Partial<TState>): TState {
  return {
    state: 'idle',
    round: 0,
    totalRounds: 0,
    roundDeadline: null,
    registrations: [],
    players: {},
    pairings: [],
    past: [],
    lastStandings: [],
    ...partial,
  }
}

function seed(partial: Partial<TState>): Promise<void> {
  return runInDurableObject(stub(), (_i, state) => state.storage.put('t', full(partial)))
}

function read(): Promise<TState> {
  return runInDurableObject(stub(), (_i, state) => state.storage.get<TState>('t')) as Promise<TState>
}

async function fireStart(): Promise<void> {
  await runInDurableObject(stub(), (_i, state) => state.storage.setAlarm(Date.now() - 1))
  await runDurableObjectAlarm(stub())
}

async function resolveRound(round: number): Promise<void> {
  const s = await read()
  for (const p of s.pairings) {
    if (p.result !== null || !p.code) continue
    await stub().reportResult({ code: p.code, round, winnerEmail: p.players[0], moves: 40 })
  }
}

async function sessionFor(email: string): Promise<string> {
  const acc = env.ACCOUNTS.get(env.ACCOUNTS.idFromName('accounts'))
  const reg = await acc.register(email)
  if (!reg.ok) throw new Error(reg.error)
  const ver = await acc.verify(email, reg.code, 'secret123')
  if (!ver.ok) throw new Error(ver.error)
  return ver.token
}

describe('pairRound', () => {
  it('pairs an even field top-to-bottom by score', () => {
    const ps = pairRound(
      [
        player('a', { score: 3 }),
        player('b', { score: 2 }),
        player('c', { score: 1 }),
        player('d', { score: 0 }),
      ],
      NEUTRAL,
    )
    expect(ps.map((p) => p.players)).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ])
    expect(ps.every((p) => p.result === null)).toBe(true)
  })

  it('gives a bye to the lowest scorer without one', () => {
    const ps = pairRound(
      [player('a', { score: 2 }), player('b', { score: 1 }), player('c', { score: 0 })],
      NEUTRAL,
    )
    expect(ps.find((p) => p.result === 'bye')?.players).toEqual(['c', null])
    expect(ps.find((p) => p.result === null)?.players).toEqual(['a', 'b'])
  })

  it('skips a player who already had a bye when assigning the next', () => {
    const ps = pairRound(
      [player('a', { score: 2 }), player('b', { score: 1 }), player('c', { score: 0, byes: 1 })],
      NEUTRAL,
    )
    expect(ps.find((p) => p.result === 'bye')?.players).toEqual(['b', null])
  })

  it('avoids an immediate rematch when a fresh opponent exists', () => {
    const ps = pairRound(
      [
        player('a', { score: 3, opponents: ['b'] }),
        player('b', { score: 2, opponents: ['a'] }),
        player('c', { score: 1 }),
        player('d', { score: 0 }),
      ],
      NEUTRAL,
    )
    expect(ps.map((p) => p.players)).toEqual([
      ['a', 'c'],
      ['b', 'd'],
    ])
  })

  it('falls back to a rematch when everyone has already met', () => {
    const ps = pairRound(
      [player('a', { opponents: ['b'] }), player('b', { opponents: ['a'] })],
      NEUTRAL,
    )
    expect(ps).toHaveLength(1)
    expect(ps[0].players).toEqual(['a', 'b'])
  })
})

describe('nextDailyStart', () => {
  it('targets the next 12:00 UTC (20:00 北京时间)', () => {
    expect(nextDailyStart(Date.UTC(2026, 0, 1, 10))).toBe(Date.UTC(2026, 0, 1, 12))
    expect(nextDailyStart(Date.UTC(2026, 0, 1, 12))).toBe(Date.UTC(2026, 0, 2, 12))
    expect(nextDailyStart(Date.UTC(2026, 0, 1, 13))).toBe(Date.UTC(2026, 0, 2, 12))
  })
})

describe('Tournament DO', () => {
  it('starts a four-player event and pairs round one into rooms', async () => {
    await seed({ registrations: ['a@x', 'b@x', 'c@x', 'd@x'] })
    await fireStart()
    const s = await read()
    expect(s.state).toBe('active')
    expect(s.round).toBe(1)
    expect(s.totalRounds).toBe(2)
    expect(s.pairings).toHaveLength(2)
    expect(s.pairings.every((p) => p.code && p.result === null)).toBe(true)
  })

  it('runs every round then returns to idle with final standings', async () => {
    await seed({ registrations: ['a@x', 'b@x', 'c@x', 'd@x'] })
    await fireStart()
    await resolveRound(1)
    await resolveRound(2)
    const s = await read()
    expect(s.state).toBe('idle')
    expect(s.lastStandings).toHaveLength(4)
    expect(s.lastStandings[0].score).toBeGreaterThanOrEqual(s.lastStandings[3].score)
  })

  it('does not start with fewer than two players', async () => {
    await seed({ registrations: ['solo@x'] })
    await fireStart()
    const s = await read()
    expect(s.state).toBe('idle')
    expect(s.registrations).toEqual(['solo@x'])
  })

  it('ignores duplicate, stale-round, and stranger reports', async () => {
    await seed({ registrations: ['a@x', 'b@x', 'c@x', 'd@x'] })
    await fireStart()
    const [p0, p1] = (await read()).pairings
    await stub().reportResult({ code: p0.code!, round: 1, winnerEmail: p0.players[0], moves: 40 })
    await stub().reportResult({ code: p0.code!, round: 1, winnerEmail: p0.players[1], moves: 40 })
    await stub().reportResult({ code: p1.code!, round: 99, winnerEmail: p1.players[0], moves: 40 })
    await stub().reportResult({ code: p1.code!, round: 1, winnerEmail: 'ghost@x', moves: 40 })
    const s = await read()
    expect(s.players[p0.players[0]!].score).toBe(1)
    expect(s.players[p0.players[1]!].score).toBe(0)
    expect(s.pairings.find((p) => p.code === p1.code)?.result).toBeNull()
    expect(s.round).toBe(1)
  })

  it('scores a long draw at 0.5 but voids a short one', async () => {
    await seed({ registrations: ['a@x', 'b@x', 'c@x', 'd@x'] })
    await fireStart()
    const [p0, p1] = (await read()).pairings
    await stub().reportResult({ code: p0.code!, round: 1, winnerEmail: null, moves: 5 })
    await stub().reportResult({ code: p1.code!, round: 1, winnerEmail: null, moves: 40 })
    const s = await read()
    expect(s.players[p0.players[0]!].score).toBe(0)
    expect(s.players[p0.players[1]!].score).toBe(0)
    expect(s.players[p1.players[0]!].score).toBe(0.5)
    expect(s.players[p1.players[1]!].score).toBe(0.5)
  })

  it('awards a walkover to the only player who checked in', async () => {
    await seed({ registrations: ['a@x', 'b@x', 'c@x', 'd@x'] })
    await fireStart()
    const [p0] = (await read()).pairings
    await stub().checkIn({ code: p0.code!, email: p0.players[0]! })
    await runInDurableObject(stub(), async (_i, state) => {
      const t = (await state.storage.get<TState>('t'))!
      t.roundDeadline = Date.now() - 10_000
      await state.storage.put('t', t)
      await state.storage.setAlarm(Date.now() - 1)
    })
    await runDurableObjectAlarm(stub())
    const s = await read()
    expect(s.players[p0.players[0]!].score).toBe(1)
    expect(s.players[p0.players[1]!].score).toBe(0)
  })

  it('no-ops a superseded round alarm instead of voiding the new round', async () => {
    await seed({ registrations: ['a@x', 'b@x', 'c@x', 'd@x'] })
    await fireStart()
    await resolveRound(1)
    expect((await read()).round).toBe(2)
    await runDurableObjectAlarm(stub()) // 未过期的本轮 alarm → closeRound 应直接返回
    const s = await read()
    expect(s.round).toBe(2)
    expect(s.pairings.every((p) => p.result === null)).toBe(true)
  })
})

describe('Tournament routes', () => {
  it('registers, reflects registration, and withdraws via the API', async () => {
    await seed({}) // 复位共享的 daily DO（同文件其它用例可能留下状态）
    const token = await sessionFor('reg@example.com')
    const auth = { headers: { Authorization: `Bearer ${token}` } }

    const reg = await SELF.fetch('https://example.com/api/tournament/register', {
      method: 'POST',
      ...auth,
    })
    expect(reg.status).toBe(200)
    expect(await reg.json()).toMatchObject({ state: 'idle', registered: true, playerCount: 1 })

    const info = await SELF.fetch('https://example.com/api/tournament', auth)
    expect(await info.json()).toMatchObject({ registered: true })

    const guest = await SELF.fetch('https://example.com/api/tournament')
    expect(await guest.json()).toMatchObject({ registered: false, playerCount: 1 })

    const withdrawn = await SELF.fetch('https://example.com/api/tournament/withdraw', {
      method: 'POST',
      ...auth,
    })
    expect(await withdrawn.json()).toMatchObject({ registered: false, playerCount: 0 })
  })

  it('rejects registration without a token', async () => {
    const res = await SELF.fetch('https://example.com/api/tournament/register', { method: 'POST' })
    expect(res.status).toBe(401)
  })
})

describe('active-state registration and spectating', () => {
  function seedActive(players: string[]): Promise<void> {
    return runInDurableObject(stub(), (_i, st) =>
      st.storage.put(
        't',
        full({
          state: 'active',
          round: 1,
          totalRounds: 1,
          roundDeadline: Date.now() + 600_000,
          players: Object.fromEntries(players.map((e) => [e, { score: 0, opponents: [], byes: 0 }])),
          pairings: [{ code: '0001', players: [players[0], players[1]], checkedIn: [], result: null }],
        }),
      ),
    )
  }

  it('lets a non-participant sign up for the next event during an active one', async () => {
    const token = await sessionFor('late@example.com')
    await seedActive(['a@x', 'b@x'])
    const info = await stub().register(token)
    expect(info.state).toBe('active')
    expect(info.participating).toBe(false)
    expect(info.registered).toBe(true)
    const s = await read()
    expect(s.registrations).toContain('late@example.com')
    expect(Object.keys(s.players).sort()).toEqual(['a@x', 'b@x'])
  })

  it('shows live standings but hides pairings from non-participants', async () => {
    const outsider = await sessionFor('outsider@example.com')
    await seedActive(['a@x', 'b@x'])
    const info = await stub().getInfo(outsider)
    expect(info.participating).toBe(false)
    expect(info.standings.length).toBe(2)
    expect(info.rounds).toEqual([])
    expect(info.myGame).toBeNull()
  })

  it('shows a participant their game and the live standings', async () => {
    const email = 'inside@example.com'
    const token = await sessionFor(email)
    await seedActive([email, 'b@x'])
    const info = await stub().getInfo(token)
    expect(info.participating).toBe(true)
    expect(info.myGame).toEqual({ code: '0001' })
    expect(info.standings.length).toBe(2)
  })

  it('exposes per-round matches with status and result to participants', async () => {
    const email = 'bracket@example.com'
    const token = await sessionFor(email)
    await runInDurableObject(stub(), (_i, st) =>
      st.storage.put(
        't',
        full({
          state: 'active',
          round: 1,
          totalRounds: 1,
          roundDeadline: Date.now() + 600_000,
          players: Object.fromEntries(
            [email, 'b@x', 'c@x', 'd@x'].map((e) => [e, { score: 0, opponents: [], byes: 0 }]),
          ),
          pairings: [
            { code: '0001', players: [email, 'b@x'], checkedIn: [email, 'b@x'], result: 'a' },
            { code: '0002', players: ['c@x', 'd@x'], checkedIn: ['c@x', 'd@x'], result: null },
          ],
        }),
      ),
    )
    const info = await stub().getInfo(token)
    expect(info.rounds.length).toBe(1)
    expect(info.rounds[0][0]).toMatchObject({ status: 'done', result: 'a' })
    expect(info.rounds[0][1].status).toBe('playing')
  })

  it('hides rounds from non-participants during an active event', async () => {
    const outsider = await sessionFor('nobody@example.com')
    await seedActive(['a@x', 'b@x'])
    const info = await stub().getInfo(outsider)
    expect(info.rounds).toEqual([])
  })
})
