import type { Difficulty } from '@gomoku/engine/ai'

// 拟人「性格」：影响对局中的墙钟节奏与和/降决策。与名单同放 env（TOURNAMENT_BOTS），代码解析、不落库。
export interface BotPersona {
  speed: number // 想手墙钟倍率：~0.7 快手 .. ~1.4 慢性子
  drawish: number // 0..1 长局均势时接受和棋的倾向
  grit: number // 0..1 顽强度：越高越死不认输
}

// TOURNAMENT_BOTS 格式：分号（或换行）分隔各 bot；单个 bot 内部用逗号分隔，首项为邮箱、其余为 `key:val` 性格项，
// 例：`a@x.com,speed:0.7,grit:0.95;b@x.com;c@x.com,speed:1.4,drawish:0.3`。
interface RosterEntry {
  email: string
  persona: Partial<BotPersona>
}

// env 名单极少变动，按原始串缓存解析结果，避免每步 AI 出手都重扫一遍整份名单。
let rosterCache: { raw: string | undefined; entries: RosterEntry[] } | null = null

function parseRoster(raw: string | undefined): RosterEntry[] {
  if (rosterCache && rosterCache.raw === raw) return rosterCache.entries
  const out: RosterEntry[] = []
  const seen = new Set<string>()
  for (const chunk of (raw ?? '').split(/[;\n]/)) {
    const [emailRaw, ...tokens] = chunk.split(',')
    const email = emailRaw?.trim()
    if (!email || seen.has(email)) continue
    seen.add(email)
    const persona: Partial<BotPersona> = {}
    for (const token of tokens) {
      const [k, v] = token.split(':').map((s) => s.trim())
      const num = Number(v)
      if ((k === 'speed' || k === 'drawish' || k === 'grit') && Number.isFinite(num)) {
        persona[k] = num
      }
    }
    out.push({ email, persona })
  }
  rosterCache = { raw, entries: out }
  return out
}

export function parseBotPool(raw: string | undefined): string[] {
  return parseRoster(raw).map((e) => e.email)
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

// 无 env 配置时按身份哈希派生稳定的个体差异（兜底匿名 AI 取中性）。
function defaultPersona(email: string | null): BotPersona {
  if (!email) return { speed: 1, drawish: 0.12, grit: 0.82 }
  const r = mulberry32(hashString(`persona:${email}`))
  return { speed: 0.7 + r() * 0.7, drawish: 0.05 + r() * 0.35, grit: 0.6 + r() * 0.35 }
}

export function botPersona(raw: string | undefined, email: string | null): BotPersona {
  const override = email ? parseRoster(raw).find((e) => e.email === email)?.persona : undefined
  const merged = { ...defaultPersona(email), ...override }
  return {
    speed: clamp(merged.speed, 0.3, 2.5),
    drawish: clamp(merged.drawish, 0, 1),
    grit: clamp(merged.grit, 0, 1),
  }
}

// 开赛前这段时间内 bot 按种子时间表陆续「报名」。
const REG_WINDOW_MS = 3 * 3600_000

// 每届陪打 bot 人数上限。
const MAX_BOTS = 3

export interface TournamentBot {
  email: string
  difficulty: Difficulty
  // 在开赛前多久「报名」
  leadMs: number
}

function hashString(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const TIERS: Difficulty[] = ['easy', 'normal', 'hard', 'master']

// 身份绑定的基准档：跨届稳定，代表这名「玩家」的常态水平。
function botDifficulty(email: string): Difficulty {
  const spread = [0, 1, 1, 2]
  return TIERS[spread[hashString(`diff:${email}`) % spread.length]]
}

// 每局实际棋力在基准 ±1 档内浮动（0.6 基准、上下各 0.2，越界收回），像真人的状态起伏。
export function gameDifficulty(base: Difficulty, rand: () => number = Math.random): Difficulty {
  const i = TIERS.indexOf(base)
  const r = rand()
  const j = r < 0.6 ? i : r < 0.8 ? i - 1 : i + 1
  return TIERS[Math.max(0, Math.min(TIERS.length - 1, j))]
}

// bot 对 bot 水平接近极易和棋：档差直接拉满，一端 easy 一端 master，绝不出现势均力敌；
// 强的一端给基准更高的 bot（同基准随机），榜单成绩仍大体贴合人设。
export function pairedBotDifficulties(
  baseA: Difficulty,
  baseB: Difficulty,
  rand: () => number = Math.random,
): [Difficulty, Difficulty] {
  const gap = TIERS.indexOf(baseA) - TIERS.indexOf(baseB)
  const aStronger = gap > 0 || (gap === 0 && rand() < 0.5)
  return aStronger ? ['master', 'easy'] : ['easy', 'master']
}

function shuffle(items: string[], rand: () => number): string[] {
  const order = [...items]
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[order[i], order[j]] = [order[j], order[i]]
  }
  return order
}

// 阵容逐日演化：上一届成员大概率留任（名次靠前留任概率稍高），人数在 1~MAX_BOTS 间 ±1 随机游走
// （与真人报名数无关），缺口从池中未在场者随机补——整体只做少量替换，不整套换血。
function evolveLineup(rand: () => number, pool: string[], prevRanked: string[]): string[] {
  const cap = Math.min(MAX_BOTS, pool.length)
  const prev = prevRanked.filter((e) => pool.includes(e))
  if (prev.length === 0) {
    return shuffle(pool, rand).slice(0, Math.min(1 + Math.floor(rand() * MAX_BOTS), cap))
  }
  const stay = prev.filter(
    (_, i) => rand() < 0.85 - (prev.length > 1 ? (0.25 * i) / (prev.length - 1) : 0),
  )
  const target = Math.max(Math.min(1, cap), Math.min(prev.length + Math.floor(rand() * 3) - 1, cap))
  const lineup = stay.slice(0, target)
  const fresh = shuffle(pool.filter((e) => !lineup.includes(e)), rand)
  while (lineup.length < target && fresh.length) lineup.push(fresh.pop()!)
  return lineup
}

// prevRanked：上一届按名次排列的池内邮箱（榜单 ∩ 池），空 = 首届全随机。
export function dailyBots(dateKey: string, pool: string[], prevRanked: string[] = []): TournamentBot[] {
  const rand = mulberry32(hashString(dateKey))
  return evolveLineup(rand, pool, prevRanked).map((email) => ({
    email,
    difficulty: botDifficulty(email),
    leadMs: Math.floor(rand() * REG_WINDOW_MS),
  }))
}

export function botRegistrations(
  dateKey: string,
  pool: string[],
  startsAt: number,
  now: number,
  prevRanked: string[] = [],
): TournamentBot[] {
  return dailyBots(dateKey, pool, prevRanked).filter((b) => startsAt - b.leadMs <= now)
}
