import { env, runDurableObjectAlarm, runInDurableObject, SELF } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { tournamentFrameSeconds } from '@/shared/protocol'
import { beijingDate, nextDailyStart } from '@/worker/tournament'
import {
  botRegistrations,
  dailyBots,
  gameDifficulty,
  pairedBotDifficulties,
  parseBotPool,
} from '@/worker/bots'

interface TPlayer {
  score: number
  wins: number
  games: number
  opponents: string[]
}

interface TState {
  state: string
  startedAt: number
  registrations: string[]
  players: Record<string, TPlayer>
  bots: Record<string, string>
  queue: string[]
  cooldowns: Record<string, number>
  botSeekAt: Record<string, number>
  pairings: Array<{
    code: string
    players: [string, string]
    checkedIn: string[]
    started?: true
    result: string | null
    createdAt: number
  }>
  lastStandings: Array<{ email: string; score: number; played: number }>
}

function stub() {
  return env.TOURNAMENT.get(env.TOURNAMENT.idFromName('daily'))
}

function full(partial: Partial<TState>): TState {
  return {
    state: 'idle',
    startedAt: 0,
    registrations: [],
    players: {},
    bots: {},
    queue: [],
    cooldowns: {},
    botSeekAt: {},
    pairings: [],
    lastStandings: [],
    ...partial,
  }
}

function zeroed(emails: string[]): Record<string, TPlayer> {
  return Object.fromEntries(emails.map((e) => [e, { score: 0, wins: 0, games: 0, opponents: [] }]))
}

function seed(partial: Partial<TState>): Promise<void> {
  return runInDurableObject(stub(), (_i, state) => state.storage.put('t', full(partial)))
}

function seedActive(emails: string[], over: Partial<TState> = {}): Promise<void> {
  return seed({ state: 'active', startedAt: Date.now() - 60_000, players: zeroed(emails), ...over })
}

function read(): Promise<TState> {
  return runInDurableObject(stub(), (_i, state) => state.storage.get<TState>('t')) as Promise<TState>
}

function patch(fn: (s: TState) => void): Promise<void> {
  return runInDurableObject(stub(), async (_i, state) => {
    const s = (await state.storage.get<TState>('t'))!
    fn(s)
    await state.storage.put('t', s)
  })
}

async function fireAlarm(): Promise<void> {
  await runInDurableObject(stub(), (_i, state) => state.storage.setAlarm(Date.now() - 1))
  await runDurableObjectAlarm(stub())
}

async function sessionFor(email: string): Promise<string> {
  const acc = env.ACCOUNTS.get(env.ACCOUNTS.idFromName('accounts'))
  const reg = await acc.register(email)
  if (!reg.ok) throw new Error(reg.error)
  const ver = await acc.verify(email, reg.code, 'secret123')
  if (!ver.ok) throw new Error(ver.error)
  return ver.token
}

describe('tournamentFrameSeconds', () => {
  it('starts at 10s, ramps 1s per frame after frame 5, caps at 45s', () => {
    expect(tournamentFrameSeconds(1)).toBe(10)
    expect(tournamentFrameSeconds(5)).toBe(10)
    expect(tournamentFrameSeconds(6)).toBe(11)
    expect(tournamentFrameSeconds(40)).toBe(45)
    expect(tournamentFrameSeconds(60)).toBe(45)
  })
})

describe('nextDailyStart', () => {
  it('targets the next 12:00 UTC (20:00 北京时间)', () => {
    expect(nextDailyStart(Date.UTC(2026, 0, 1, 10))).toBe(Date.UTC(2026, 0, 1, 12))
    expect(nextDailyStart(Date.UTC(2026, 0, 1, 12))).toBe(Date.UTC(2026, 0, 2, 12))
    expect(nextDailyStart(Date.UTC(2026, 0, 1, 13))).toBe(Date.UTC(2026, 0, 2, 12))
  })
})

describe('Arena tournament DO', () => {
  it('starts the arena without auto-pairing anyone', async () => {
    await seed({ registrations: ['a@x', 'b@x', 'c@x', 'd@x'] })
    await fireAlarm()
    const s = await read()
    expect(s.state).toBe('active')
    expect(s.pairings).toEqual([])
    expect(s.queue).toEqual([])
    expect(Object.keys(s.players)).toHaveLength(4)
    expect(s.players['a@x']).toEqual({ score: 0, wins: 0, games: 0, opponents: [] })
  })

  it('does not start with fewer than two players', async () => {
    await seed({ registrations: ['solo@x'] })
    await fireAlarm()
    const s = await read()
    expect(s.state).toBe('idle')
    expect(s.registrations).toEqual(['solo@x'])
  })

  it('pairs two seekers into a room and clears the queue', async () => {
    const ea = 'seek-a@example.com'
    const eb = 'seek-b@example.com'
    const ta = await sessionFor(ea)
    const tb = await sessionFor(eb)
    await seedActive([ea, eb])
    const first = await stub().seekMatch(ta)
    expect(first.my?.status).toBe('matching')
    const second = await stub().seekMatch(tb)
    expect(second.myGame?.code).toBeTruthy()
    expect(second.my?.status).toBe('readying')
    const s = await read()
    expect(s.queue).toEqual([])
    expect(s.pairings).toHaveLength(1)
    expect([...s.pairings[0].players].sort()).toEqual([ea, eb])
    expect(s.players[ea].opponents).toEqual([eb])
    expect(s.players[eb].opponents).toEqual([ea])
  })

  it('cancels a pending seek and no-ops once already paired', async () => {
    const e = 'unseek@example.com'
    const t = await sessionFor(e)
    await seedActive([e, 'b@x'])
    await stub().seekMatch(t)
    const cancelled = await stub().cancelSeek(t)
    expect(cancelled.my?.status).toBe('idle')
    expect((await read()).queue).toEqual([])

    await patch((s) => {
      s.pairings = [
        { code: '0011', players: [e, 'b@x'], checkedIn: [], result: null, createdAt: Date.now() },
      ]
    })
    const paired = await stub().cancelSeek(t)
    expect(paired.my?.status).toBe('readying')
    expect(paired.myGame).toEqual({ code: '0011' })
  })

  it('prefers a fresh opponent over an immediate rematch', async () => {
    await seedActive(['a@x', 'b@x', 'c@x'], { queue: ['a@x', 'b@x', 'c@x'] })
    await patch((s) => {
      s.players['a@x'].opponents = ['b@x']
      s.players['b@x'].opponents = ['a@x']
    })
    await fireAlarm()
    const s = await read()
    expect(s.pairings).toHaveLength(1)
    expect([...s.pairings[0].players].sort()).toEqual(['a@x', 'c@x'])
    expect(s.queue).toEqual(['b@x'])
  })

  it('blocks seeking during cooldown, an unresolved game, or after close', async () => {
    const e = 'cool@example.com'
    const t = await sessionFor(e)
    await seedActive([e, 'b@x'])
    await patch((s) => {
      s.cooldowns[e] = Date.now() + 30_000
    })
    const cooling = await stub().seekMatch(t)
    expect(cooling.my?.status).toBe('cooldown')
    expect((await read()).queue).toEqual([])

    await patch((s) => {
      s.cooldowns[e] = Date.now() - 1
    })
    const ok = await stub().seekMatch(t)
    expect(ok.my?.status).toBe('matching')

    await patch((s) => {
      s.queue = []
      s.pairings = [
        { code: '0009', players: [e, 'b@x'], checkedIn: [], result: null, createdAt: Date.now() },
      ]
    })
    const busy = await stub().seekMatch(t)
    expect(busy.my?.status).toBe('readying')
    expect((await read()).queue).toEqual([])

    await patch((s) => {
      s.pairings = []
      s.startedAt = Date.now() - 31 * 60_000
    })
    const late = await stub().seekMatch(t)
    expect(late.my?.status).toBe('idle')
    expect((await read()).queue).toEqual([])
  })

  it('scores a win, sets both cooldowns, and ignores duplicates and strangers', async () => {
    await seedActive(['a@x', 'b@x', 'c@x'], {
      pairings: [
        { code: '0021', players: ['a@x', 'b@x'], checkedIn: [], result: null, createdAt: Date.now() },
      ],
    })
    await stub().reportResult({ code: '0021', winnerEmail: 'ghost@x', moves: 40 })
    expect((await read()).pairings[0].result).toBeNull()
    await stub().reportResult({ code: '0021', winnerEmail: 'a@x', moves: 40 })
    await stub().reportResult({ code: '0021', winnerEmail: 'b@x', moves: 40 })
    const s = await read()
    expect(s.pairings[0].result).toBe('a')
    expect(s.players['a@x']).toMatchObject({ score: 1, wins: 1, games: 1 })
    expect(s.players['b@x']).toMatchObject({ score: 0, wins: 0, games: 1 })
    expect(s.cooldowns['a@x']).toBeGreaterThan(Date.now())
    expect(s.cooldowns['b@x']).toBeGreaterThan(Date.now())
    expect(s.state).toBe('active')
  })

  it('scores a long draw at 0.5 but voids a short one', async () => {
    await seedActive(['a@x', 'b@x', 'c@x', 'd@x'], {
      pairings: [
        { code: '0031', players: ['a@x', 'b@x'], checkedIn: [], result: null, createdAt: Date.now() },
        { code: '0032', players: ['c@x', 'd@x'], checkedIn: [], result: null, createdAt: Date.now() },
      ],
    })
    await stub().reportResult({ code: '0031', winnerEmail: null, moves: 5 })
    await stub().reportResult({ code: '0032', winnerEmail: null, moves: 40 })
    const s = await read()
    expect(s.pairings[0].result).toBe('void')
    expect(s.players['a@x'].score).toBe(0)
    expect(s.pairings[1].result).toBe('draw')
    expect(s.players['c@x'].score).toBe(0.5)
    expect(s.players['d@x'].score).toBe(0.5)
  })

  it('resolves a stalled pairing by attendance', async () => {
    const stale = Date.now() - 3 * 60_000
    await seedActive(['a@x', 'b@x', 'c@x', 'd@x'], {
      pairings: [
        { code: '0041', players: ['a@x', 'b@x'], checkedIn: ['a@x'], result: null, createdAt: stale },
        { code: '0042', players: ['c@x', 'd@x'], checkedIn: [], result: null, createdAt: stale },
      ],
    })
    await fireAlarm()
    const s = await read()
    expect(s.pairings[0].result).toBe('a')
    expect(s.players['a@x'].score).toBe(1)
    expect(s.pairings[1].result).toBe('void')
    expect(s.players['c@x'].score).toBe(0)
  })

  it('honors a result landing after the window closed, then finishes and archives', async () => {
    const opened = Date.now() - 31 * 60_000
    await seedActive(['a@x', 'b@x'], {
      startedAt: opened,
      pairings: [
        {
          code: '0051',
          players: ['a@x', 'b@x'],
          checkedIn: ['a@x', 'b@x'],
          started: true,
          result: null,
          createdAt: opened + 60_000,
        },
      ],
    })
    await fireAlarm() // 窗口已关但对局未决 → 不收官
    expect((await read()).state).toBe('active')
    await stub().reportResult({ code: '0051', winnerEmail: 'a@x', moves: 40 })
    const s = await read()
    expect(s.state).toBe('idle')
    expect(s.lastStandings[0]).toMatchObject({ email: 'a@x', score: 1, played: 1 })
    expect(s.lastStandings[1]).toMatchObject({ email: 'b@x', score: 0 })
    const archived = await runInDurableObject(stub(), (_i, st) =>
      st.storage.get(`standings:${beijingDate(Date.now())}`),
    )
    expect(archived).toEqual(s.lastStandings)
  })

  it('finishes at window close when nothing is pending', async () => {
    await seedActive(['a@x', 'b@x'], {
      startedAt: Date.now() - 31 * 60_000,
      pairings: [
        {
          code: '0061',
          players: ['a@x', 'b@x'],
          checkedIn: ['a@x', 'b@x'],
          result: 'a',
          createdAt: Date.now() - 20 * 60_000,
        },
      ],
    })
    await patch((s) => {
      s.players['a@x'] = { score: 1, wins: 1, games: 1, opponents: ['b@x'] }
      s.players['b@x'] = { score: 0, wins: 0, games: 1, opponents: ['a@x'] }
    })
    await fireAlarm()
    const s = await read()
    expect(s.state).toBe('idle')
    expect(s.lastStandings.map((r) => r.email)).toEqual(['a@x', 'b@x'])
  })

  it('wraps up zombie games long after close as draw or void', async () => {
    const opened = Date.now() - 51 * 60_000
    await seedActive(['a@x', 'b@x', 'c@x', 'd@x'], {
      startedAt: opened,
      pairings: [
        {
          code: '0071',
          players: ['a@x', 'b@x'],
          checkedIn: ['a@x', 'b@x'],
          started: true,
          result: null,
          createdAt: opened + 60_000,
        },
        {
          code: '0072',
          players: ['c@x', 'd@x'],
          checkedIn: ['c@x', 'd@x'],
          result: null,
          createdAt: opened + 60_000,
        },
      ],
    })
    await fireAlarm()
    const s = await read()
    expect(s.state).toBe('idle')
    const scores = Object.fromEntries(s.lastStandings.map((r) => [r.email, r.score]))
    expect(scores['a@x']).toBe(0.5) // 已开局双方在场 → 判平
    expect(scores['b@x']).toBe(0.5)
    expect(scores['c@x']).toBe(0) // 未开局 → 作废
    expect(scores['d@x']).toBe(0)
  })

  it('sends due bots into the queue and pairs them', async () => {
    const b0 = 'sb0@pool.example'
    const b1 = 'sb1@pool.example'
    await seedActive([b0, b1], {
      bots: { [b0]: 'normal', [b1]: 'hard' },
      botSeekAt: { [b0]: Date.now() - 5_000, [b1]: Date.now() - 3_000 },
    })
    await fireAlarm()
    const s = await read()
    expect(s.pairings).toHaveLength(1)
    expect(s.pairings[0].code).toBeTruthy()
    expect(s.queue).toEqual([])
    expect(Object.keys(s.botSeekAt)).toEqual([])
  })

  it('reschedules a bot seek after its game resolves', async () => {
    const b0 = 'rs0@pool.example'
    await seedActive([b0, 'h@x'], {
      bots: { [b0]: 'normal' },
      pairings: [
        { code: '0081', players: [b0, 'h@x'], checkedIn: [], result: null, createdAt: Date.now() },
      ],
    })
    await stub().reportResult({ code: '0081', winnerEmail: 'h@x', moves: 40 })
    const s = await read()
    expect(s.botSeekAt[b0]).toBeGreaterThan(s.cooldowns[b0])
  })
})

describe('arena statuses and spectate gating', () => {
  it('derives the five player statuses and hands codes to free participants', async () => {
    const me = 'status-me@example.com'
    const token = await sessionFor(me)
    await seedActive([me, 'b@x', 'c@x', 'd@x', 'e@x', 'f@x', 'g@x'], {
      queue: ['b@x'],
      cooldowns: { 'g@x': Date.now() + 20_000 },
      pairings: [
        {
          code: '0301',
          players: ['c@x', 'd@x'],
          checkedIn: ['c@x', 'd@x'],
          started: true,
          result: null,
          createdAt: Date.now(),
        },
        { code: '0302', players: ['e@x', 'f@x'], checkedIn: ['e@x'], result: null, createdAt: Date.now() },
        {
          code: '0303',
          players: [me, 'g@x'],
          checkedIn: [me, 'g@x'],
          result: 'a',
          createdAt: Date.now() - 60_000,
        },
      ],
    })
    const info = await stub().getInfo(token)
    expect(info.my).toMatchObject({ status: 'idle' })
    const byEmail = Object.fromEntries(info.standings.map((r) => [r.email, r.status]))
    expect(byEmail['b***@x']).toBe('matching')
    expect(byEmail['c***@x']).toBe('playing')
    expect(byEmail['d***@x']).toBe('playing')
    expect(byEmail['e***@x']).toBe('readying')
    expect(byEmail['g***@x']).toBe('cooldown')
    // 我不在对局中 → 进行中的桌下发观战房号；已结束的不带
    expect(info.games.find((m) => m.status === 'playing')?.code).toBe('0301')
    expect(info.games.find((m) => m.status === 'done')?.code).toBeNull()
  })

  it('hides spectate codes while my own game is unresolved', async () => {
    const me = 'busy-me@example.com'
    const token = await sessionFor(me)
    await seedActive([me, 'b@x', 'c@x', 'd@x'], {
      pairings: [
        { code: '0311', players: [me, 'b@x'], checkedIn: [], result: null, createdAt: Date.now() },
        {
          code: '0312',
          players: ['c@x', 'd@x'],
          checkedIn: ['c@x', 'd@x'],
          started: true,
          result: null,
          createdAt: Date.now(),
        },
      ],
    })
    const info = await stub().getInfo(token)
    expect(info.my?.status).toBe('readying')
    expect(info.myGame).toEqual({ code: '0311' })
    expect(info.games.every((m) => m.code === null)).toBe(true)
  })

  it('hides games from non-participants during an active event', async () => {
    const outsider = await sessionFor('outsider@example.com')
    await seedActive(['a@x', 'b@x'])
    const info = await stub().getInfo(outsider)
    expect(info.participating).toBe(false)
    expect(info.standings.length).toBe(2)
    expect(info.games).toEqual([])
    expect(info.myGame).toBeNull()
    expect(info.my).toBeNull()
  })

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

  it('rejects registration and seeking without a token', async () => {
    const reg = await SELF.fetch('https://example.com/api/tournament/register', { method: 'POST' })
    expect(reg.status).toBe(401)
    const seek = await SELF.fetch('https://example.com/api/tournament/seek', { method: 'POST' })
    expect(seek.status).toBe(401)
  })
})

describe('websocket push', () => {
  interface WsClient {
    next(): Promise<{ registered: boolean; playerCount: number; me: number | null }>
  }

  async function connectWs(token?: string): Promise<WsClient> {
    const res = await SELF.fetch(
      `https://example.com/api/tournament/ws${token ? `?token=${token}` : ''}`,
      { headers: { Upgrade: 'websocket' } },
    )
    expect(res.status).toBe(101)
    const ws = res.webSocket!
    ws.accept()
    const queue: string[] = []
    const waiters: Array<() => void> = []
    ws.addEventListener('message', (event) => {
      queue.push(event.data as string)
      waiters.shift()?.()
    })
    return {
      async next() {
        while (queue.length === 0) {
          await new Promise<void>((resolve) => waiters.push(resolve))
        }
        return JSON.parse(queue.shift()!)
      },
    }
  }

  it('sends a personalized frame on connect and pushes on state changes', async () => {
    await seed({})
    const email = 'push@example.com'
    const token = await sessionFor(email)
    const mine = await connectWs(token)
    const guest = await connectWs()

    const first = await mine.next()
    expect(first.registered).toBe(false)
    expect((await guest.next()).registered).toBe(false)

    await stub().register(token)
    const pushed = await mine.next()
    expect(pushed.registered).toBe(true)
    expect(pushed.playerCount).toBe(1)
    // 游客也收到同一次变更，但按其身份个性化。
    const guestPushed = await guest.next()
    expect(guestPushed.registered).toBe(false)
    expect(guestPushed.playerCount).toBe(1)
  })

  it('rejects non-websocket requests', async () => {
    const res = await SELF.fetch('https://example.com/api/tournament/ws')
    expect(res.status).toBe(426)
  })
})

describe('tournament bots', () => {
  const POOL = Array.from({ length: 10 }, (_, i) => `bot${i}@pool.example`)

  it('parses the comma-separated pool from the environment value', () => {
    expect(parseBotPool(' a@x , b@y ,,a@x,')).toEqual(['a@x', 'b@y'])
    expect(parseBotPool('')).toEqual([])
    expect(parseBotPool(undefined)).toEqual([])
  })

  it('picks a deterministic daily lineup with identity-bound strength', () => {
    const lineup = dailyBots('2026-08-31', POOL)
    expect(dailyBots('2026-08-31', POOL)).toEqual(lineup)
    expect(lineup.length).toBeGreaterThanOrEqual(1)
    expect(lineup.length).toBeLessThanOrEqual(4)
    expect(new Set(lineup.map((b) => b.email)).size).toBe(lineup.length)

    const nextDay = dailyBots('2026-09-01', POOL)
    // 棋力绑定身份：跨日期同邮箱同棋力
    for (const bot of nextDay) {
      const same = lineup.find((x) => x.email === bot.email)
      if (same) expect(same.difficulty).toBe(bot.difficulty)
    }
  })

  it('ramps virtual registrations monotonically up to the full lineup', () => {
    const dateKey = '2026-08-31'
    const startsAt = 1_772_280_000_000
    expect(botRegistrations(dateKey, POOL, startsAt, startsAt - 4 * 3600_000)).toHaveLength(0)
    expect(botRegistrations(dateKey, POOL, startsAt, startsAt)).toHaveLength(
      dailyBots(dateKey, POOL).length,
    )
    let prev = 0
    for (let minutes = 180; minutes >= 0; minutes -= 15) {
      const n = botRegistrations(dateKey, POOL, startsAt, startsAt - minutes * 60_000).length
      expect(n).toBeGreaterThanOrEqual(prev)
      prev = n
    }
  })

  it('scales the lineup down for a tiny pool', () => {
    expect(dailyBots('2026-08-31', ['only@x'])).toHaveLength(1)
    expect(dailyBots('2026-08-31', [])).toHaveLength(0)
  })

  const dateKey = (i: number) =>
    new Date(Date.UTC(2026, 8, 1) + i * 86_400_000).toISOString().slice(0, 10)

  it('evolves the lineup day by day with few replacements and varied sizes', () => {
    let prev: string[] = []
    const sizes = new Set<number>()
    let retained = 0
    let carried = 0
    for (let i = 0; i < 60; i++) {
      const next = dailyBots(dateKey(i), POOL, prev).map((b) => b.email)
      expect(next.length).toBeGreaterThanOrEqual(1)
      expect(next.length).toBeLessThanOrEqual(4)
      sizes.add(next.length)
      if (prev.length) {
        retained += prev.filter((e) => next.includes(e)).length
        carried += prev.length
      }
      prev = next
    }
    expect(sizes.size).toBeGreaterThanOrEqual(3)
    expect([...sizes].some((n) => n % 2 === 1)).toBe(true)
    // 少量替换：平均留任率过半
    expect(retained / carried).toBeGreaterThan(0.5)
  })

  it('lets higher-ranked bots return more often than lower-ranked ones', () => {
    const prevRanked = POOL.slice(0, 4)
    let top = 0
    let bottom = 0
    for (let i = 0; i < 300; i++) {
      const emails = dailyBots(dateKey(i), POOL, prevRanked).map((b) => b.email)
      if (emails.includes(prevRanked[0])) top++
      if (emails.includes(prevRanked[3])) bottom++
    }
    expect(top).toBeGreaterThan(bottom)
  })

  it('floats per-game difficulty within one tier of the base', () => {
    const tiers = ['easy', 'normal', 'hard', 'master']
    for (const base of ['easy', 'normal', 'hard'] as const) {
      const seen = new Set<string>()
      for (let i = 0; i < 1000; i++) seen.add(gameDifficulty(base))
      const idx = tiers.indexOf(base)
      for (const d of seen) expect(Math.abs(tiers.indexOf(d) - idx)).toBeLessThanOrEqual(1)
      expect(seen.size).toBeGreaterThan(1)
    }
  })

  it('never gives two bots in one game the same difficulty', () => {
    for (let i = 0; i < 500; i++) {
      const [a, b] = pairedBotDifficulties('normal', 'normal')
      expect(a).not.toBe(b)
      const [c, d] = pairedBotDifficulties('easy', 'hard')
      expect(c).not.toBe(d)
    }
  })

  it('fills the field with 1-4 bots and schedules their first seeks', async () => {
    await seed({ registrations: ['solo@x'] })
    await runInDurableObject(stub(), (instance) => {
      ;(instance as unknown as { env: Record<string, string> }).env.TOURNAMENT_BOTS = POOL.join(',')
    })
    await fireAlarm()
    const s = await read()
    expect(s.state).toBe('active')
    const emails = Object.keys(s.players)
    expect(emails).toContain('solo@x')
    const botEmails = Object.keys(s.bots)
    expect(botEmails.length).toBeGreaterThanOrEqual(1)
    expect(botEmails.length).toBeLessThanOrEqual(4)
    // 竞技场不发牌：开赛时无配对，bot 各自排了首次「点匹配」的时点
    expect(s.pairings).toEqual([])
    for (const bot of botEmails) {
      expect(s.botSeekAt[bot]).toBeGreaterThan(s.startedAt)
    }
  })
})
