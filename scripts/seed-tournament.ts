// 由 Node 原生运行 TypeScript（同 ai:battle）：给本地 dev 的每日大赛注入演示数据。
// 用法：pnpm seed:tournament [active|idle] [--url http://localhost:5173]
//  - active（默认）：第 2/3 轮进行中，四种状态齐全（对局中/待开始/已结束/已离开）
//  - idle：只写一份「昨日排名」
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
  players: Record<string, { score: number; opponents: string[]; byes: number }>
  pairings: Pairing[]
  past: Pairing[][]
  lastStandings?: Array<{ email: string; score: number; played: number }>
}

const KOBA = 'kobayashi@example.com'
const OUTLOOK = 'shewulong@outlook.com'
const ZHANG = 'zhangwei@example.com'
const GMAIL = 'shewulong@gmail.com'
const LIU = 'liuyang@example.com'
const WANG = 'wangfang@example.com'
const CHEN = 'chenjing@example.com'
const LINA = 'lina@example.com'

function pairing(
  code: string,
  a: string,
  b: string,
  checkedIn: string[],
  result: Pairing['result'],
): Pairing {
  return { code, players: [a, b], checkedIn, result }
}

// 第 1 轮已归档；第 2 轮：一桌已出结果（已结束）、一桌对弈中、一桌没进场（待开始）、一桌缺席判负（已离开）。
const ACTIVE: SeedState = {
  state: 'active',
  round: 2,
  totalRounds: 3,
  players: {
    [KOBA]: { score: 2, opponents: [LINA, OUTLOOK], byes: 0 },
    [OUTLOOK]: { score: 1, opponents: [CHEN, KOBA], byes: 0 },
    [ZHANG]: { score: 1, opponents: [WANG, GMAIL], byes: 0 },
    [GMAIL]: { score: 0.5, opponents: [LIU, ZHANG], byes: 0 },
    [LIU]: { score: 0.5, opponents: [GMAIL, WANG], byes: 0 },
    [WANG]: { score: 0, opponents: [ZHANG, LIU], byes: 0 },
    [CHEN]: { score: 0, opponents: [OUTLOOK, LINA], byes: 0 },
    [LINA]: { score: 1, opponents: [KOBA, CHEN], byes: 0 },
  },
  pairings: [
    pairing('9201', KOBA, OUTLOOK, [KOBA, OUTLOOK], 'a'),
    pairing('9202', ZHANG, GMAIL, [ZHANG, GMAIL], null),
    pairing('9203', LIU, WANG, [], null),
    pairing('9204', CHEN, LINA, [LINA], 'b'),
  ],
  past: [
    [
      pairing('9101', KOBA, LINA, [KOBA, LINA], 'a'),
      pairing('9102', OUTLOOK, CHEN, [OUTLOOK, CHEN], 'a'),
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

const args = process.argv.slice(2)
const mode = args.find((a) => !a.startsWith('--')) ?? 'active'
const urlFlag = args.indexOf('--url')
const base = urlFlag >= 0 ? args[urlFlag + 1] : 'http://localhost:5173'

if (mode !== 'active' && mode !== 'idle') {
  console.error(`未知模式：${mode}（可选 active | idle）`)
  process.exit(1)
}

const res = await fetch(`${base}/api/tournament/seed`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(mode === 'idle' ? IDLE : ACTIVE),
})
if (!res.ok) {
  console.error(`seed 失败：${res.status}（dev server 是否在 ${base}？）`)
  process.exit(1)
}
console.log(`已注入 ${mode === 'idle' ? '昨日排名' : '进行中（第 2/3 轮，四种状态）'} → ${base}`)

export {}
