// 由 Node 原生运行 TypeScript（同 ai:battle）：给本地 dev 的每日大赛注入演示数据。
// 用法：pnpm seed:tournament [active|idle|prestart|spectate] [--url http://localhost:5173]
//  - active（默认）：竞技场进行中，五种状态齐全（空闲/匹配中/准备中/对局中/冷却中）
//  - idle：只写一份「上届排名」
//  - prestart：shewulong@outlook.com 已报名、2 分钟后开赛（走真实 start：bot 注水补位、真打）
//  - spectate：同 active，但「对局中」那桌换成真房 + 双 AI 自动对弈，outlook 空闲可观战
// 数据经 worker 的 dev 专用注入口（仅 vite dev 存在）写进活着的 Tournament DO 并即时广播。
// 形状对齐 src/worker/tournament.ts 的 TournamentState/Pairing（不直接 import，避免把
// worker 模块拖进 node 侧类型检查）。
interface Pairing {
  code: string
  players: [string, string]
  checkedIn: string[]
  started?: true
  result: 'a' | 'b' | 'draw' | 'void' | null
  createdAt: number
}

interface SeedState {
  state: 'idle' | 'active'
  startedAt?: number
  registrations?: string[]
  players: Record<string, { score: number; wins: number; games: number; opponents: string[] }>
  bots?: Record<string, string>
  queue?: string[]
  cooldowns?: Record<string, number>
  botSeekAt?: Record<string, number>
  pairings: Pairing[]
  lastStandings?: Array<{ email: string; score: number; played: number }>
  devStartsAt?: number
}

const KOBA = 'kobayashi@example.com'
const OUTLOOK = 'shewulong@outlook.com'
const ZHANG = 'zhangwei@example.com'
const GMAIL = 'shewulong@gmail.com'
const LIU = 'liuyang@example.com'
const WANG = 'wangfang@example.com'
const CHEN = 'chenjing@example.com'
const LINA = 'lina@example.com'
const TEST1 = 'test1@example.com'
const TEST2 = 'test2@example.com'

function player(
  score: number,
  wins: number,
  games: number,
  opponents: string[],
): SeedState['players'][string] {
  return { score, wins, games, opponents }
}

// 竞技场开赛 10 分钟：outlook 空闲（可点匹配/观战）、test1 匹配中、zhangwei vs gmail 对局中、
// test2 vs koba 准备中、liuyang 冷却中，wang 已和 liu 打完一局。
const ACTIVE: SeedState = {
  state: 'active',
  startedAt: Date.now() - 10 * 60_000,
  players: {
    [OUTLOOK]: player(1, 1, 1, [KOBA]),
    [KOBA]: player(0, 0, 1, [OUTLOOK]),
    [ZHANG]: player(1, 1, 1, [WANG]),
    [GMAIL]: player(0.5, 0, 1, [LIU]),
    [LIU]: player(1.5, 1, 2, [GMAIL, WANG]),
    [WANG]: player(0, 0, 2, [ZHANG, LIU]),
    [TEST1]: player(0, 0, 0, []),
    [TEST2]: player(0, 0, 0, []),
  },
  queue: [TEST1],
  cooldowns: { [LIU]: Date.now() + 25_000 },
  pairings: [
    { code: '9101', players: [OUTLOOK, KOBA], checkedIn: [OUTLOOK, KOBA], result: 'a', createdAt: Date.now() - 9 * 60_000 },
    { code: '9102', players: [ZHANG, WANG], checkedIn: [ZHANG, WANG], result: 'a', createdAt: Date.now() - 8 * 60_000 },
    { code: '9103', players: [GMAIL, LIU], checkedIn: [GMAIL, LIU], result: 'draw', createdAt: Date.now() - 7 * 60_000 },
    { code: '9104', players: [LIU, WANG], checkedIn: [LIU, WANG], result: 'a', createdAt: Date.now() - 4 * 60_000 },
    { code: '9105', players: [ZHANG, GMAIL], checkedIn: [ZHANG, GMAIL], started: true, result: null, createdAt: Date.now() - 2 * 60_000 },
    { code: '9106', players: [TEST2, KOBA], checkedIn: [TEST2], result: null, createdAt: Date.now() - 30_000 },
  ],
}

const IDLE: SeedState = {
  state: 'idle',
  players: {},
  pairings: [],
  lastStandings: [
    { email: KOBA, score: 3, played: 4 },
    { email: OUTLOOK, score: 2.5, played: 3 },
    { email: ZHANG, score: 2.5, played: 4 },
    { email: GMAIL, score: 2, played: 3 },
    { email: LIU, score: 2, played: 3 },
    { email: WANG, score: 1.5, played: 2 },
    { email: CHEN, score: 1, played: 2 },
    { email: LINA, score: 0.5, played: 1 },
  ],
}

const PRESTART: SeedState = {
  ...IDLE,
  registrations: [OUTLOOK],
  players: {},
  lastStandings: IDLE.lastStandings,
  devStartsAt: Date.now() + 2 * 60_000,
}

const args = process.argv.slice(2)
const mode = args.find((a) => !a.startsWith('--')) ?? 'active'
const urlFlag = args.indexOf('--url')
const base = urlFlag >= 0 ? args[urlFlag + 1] : 'http://localhost:5173'

const SEEDS: Record<string, { body: SeedState; label: string }> = {
  active: { body: ACTIVE, label: '竞技场进行中（五种状态齐全）' },
  idle: { body: IDLE, label: '上届排名' },
  prestart: { body: PRESTART, label: `${OUTLOOK} 已报名，2 分钟后开赛` },
}
let seed = SEEDS[mode]
if (mode === 'spectate') {
  const alloc = await fetch(
    `${base}/api/dev/tournament-room?p0=${encodeURIComponent(ZHANG)}&p1=${encodeURIComponent(GMAIL)}&ai0=normal&ai1=hard`,
  )
  if (!alloc.ok) {
    console.error(`建房失败：${alloc.status}（dev server 是否在 ${base}？）`)
    process.exit(1)
  }
  const { code } = (await alloc.json()) as { code: string }
  const body = structuredClone(ACTIVE)
  // 双 AI 会在 5~60s 内错峰进场（准备中），到齐自动开局（对局中），随后可观战。
  body.pairings[4] = { code, players: [ZHANG, GMAIL], checkedIn: [], result: null, createdAt: Date.now() }
  seed = { body, label: `观战演示：${ZHANG} vs ${GMAIL} 双 AI 对弈（房 ${code}）` }
}
if (!seed) {
  console.error(`未知模式：${mode}（可选 active | idle | prestart | spectate）`)
  process.exit(1)
}

const res = await fetch(`${base}/api/tournament/seed`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(seed.body),
})
if (!res.ok) {
  console.error(`seed 失败：${res.status}（dev server 是否在 ${base}？）`)
  process.exit(1)
}
console.log(`已注入 ${seed.label} → ${base}`)

export {}
