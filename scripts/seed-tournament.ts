// 由 Node 原生运行 TypeScript（同 ai:battle）：给本地 dev 的每日大赛注入演示数据。
// 用法：pnpm seed:tournament [active|idle|prestart] [--url http://localhost:5173]
//  - active（默认）：第 2/3 轮进行中，四种状态齐全（对局中/待开始/已结束/已离开）
//  - idle：只写一份「昨日排名」
//  - prestart：shewulong@outlook.com 已报名、2 分钟后开赛（走真实 start：bot 注水补位、真打）
// 数据经 worker 的 dev 专用注入口（仅 vite dev 存在）写进活着的 Tournament DO 并即时广播。
// 形状对齐 src/worker/tournament.ts 的 TournamentState/Pairing（不直接 import，避免把
// worker 模块拖进 node 侧类型检查）。
interface Pairing {
  code: string | null
  players: [string, string | null]
  checkedIn: string[]
  result: 'a' | 'b' | 'draw' | 'void' | 'bye' | null
}

interface SeedState {
  state: 'idle' | 'active'
  round: number
  totalRounds: number
  registrations?: string[]
  players: Record<string, { score: number; opponents: string[]; byes: number }>
  bots?: Record<string, string>
  pairings: Pairing[]
  past: Pairing[][]
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

function pairing(
  code: string,
  a: string,
  b: string,
  checkedIn: string[],
  result: Pairing['result'],
): Pairing {
  return { code, players: [a, b], checkedIn, result }
}

// 第 1 轮已归档；第 2 轮：outlook 已结束（可观战），test1/test2 待开始，
// zhangwei vs gmail 对局中，liuyang 缺席判负（已离开）。
const ACTIVE: SeedState = {
  state: 'active',
  round: 2,
  totalRounds: 3,
  players: {
    [OUTLOOK]: { score: 2, opponents: [TEST1, KOBA], byes: 0 },
    [KOBA]: { score: 1, opponents: [TEST2, OUTLOOK], byes: 0 },
    [ZHANG]: { score: 1, opponents: [WANG, GMAIL], byes: 0 },
    [GMAIL]: { score: 0.5, opponents: [LIU, ZHANG], byes: 0 },
    [LIU]: { score: 0.5, opponents: [GMAIL, WANG], byes: 0 },
    [WANG]: { score: 1, opponents: [ZHANG, LIU], byes: 0 },
    [TEST1]: { score: 0, opponents: [OUTLOOK, TEST2], byes: 0 },
    [TEST2]: { score: 0, opponents: [KOBA, TEST1], byes: 0 },
  },
  pairings: [
    pairing('9201', OUTLOOK, KOBA, [OUTLOOK, KOBA], 'a'),
    pairing('9202', ZHANG, GMAIL, [ZHANG, GMAIL], null),
    pairing('9203', LIU, WANG, [WANG], 'b'),
    pairing('9204', TEST1, TEST2, [], null),
  ],
  past: [
    [
      pairing('9101', OUTLOOK, TEST1, [OUTLOOK, TEST1], 'a'),
      pairing('9102', KOBA, TEST2, [KOBA, TEST2], 'a'),
      pairing('9103', ZHANG, WANG, [ZHANG, WANG], 'a'),
      pairing('9104', GMAIL, LIU, [GMAIL, LIU], 'draw'),
    ],
  ],
}

const IDLE: SeedState = {
  state: 'idle',
  round: 0,
  totalRounds: 0,
  players: {},
  pairings: [],
  past: [],
  lastStandings: [
    { email: KOBA, score: 3, played: 3 },
    { email: OUTLOOK, score: 2.5, played: 3 },
    { email: ZHANG, score: 2.5, played: 3 },
    { email: GMAIL, score: 2, played: 3 },
    { email: LIU, score: 2, played: 3 },
    { email: WANG, score: 1.5, played: 3 },
    { email: CHEN, score: 1, played: 3 },
    { email: LINA, score: 0.5, played: 3 },
  ],
}

const PRESTART: SeedState = {
  ...IDLE,
  registrations: [OUTLOOK],
  players: {},
  bots: {},
  devStartsAt: Date.now() + 2 * 60_000,
}

const args = process.argv.slice(2)
const mode = args.find((a) => !a.startsWith('--')) ?? 'active'
const urlFlag = args.indexOf('--url')
const base = urlFlag >= 0 ? args[urlFlag + 1] : 'http://localhost:5173'

const SEEDS: Record<string, { body: SeedState; label: string }> = {
  active: { body: ACTIVE, label: '进行中（第 2/3 轮，四种状态）' },
  idle: { body: IDLE, label: '昨日排名' },
  prestart: { body: PRESTART, label: `${OUTLOOK} 已报名，2 分钟后开赛` },
}
const seed = SEEDS[mode]
if (!seed) {
  console.error(`未知模式：${mode}（可选 active | idle | prestart）`)
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
