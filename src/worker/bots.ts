import type { Difficulty } from '@gomoku/engine/ai'

export function parseBotPool(raw: string | undefined): string[] {
  return [...new Set((raw ?? '').split(',').map((s) => s.trim()).filter(Boolean))]
}

// 开赛前这段时间内 bot 按种子时间表陆续「报名」。
const REG_WINDOW_MS = 3 * 3600_000

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

// bot 对 bot 同档极易和棋：撞档时把 b 挪到其浮动范围内的另一档，保证两侧不同。
export function pairedBotDifficulties(
  baseA: Difficulty,
  baseB: Difficulty,
  rand: () => number = Math.random,
): [Difficulty, Difficulty] {
  const a = gameDifficulty(baseA, rand)
  let b = gameDifficulty(baseB, rand)
  if (b === a) {
    const i = TIERS.indexOf(baseB)
    const band = [i - 1, i, i + 1]
      .filter((j) => j >= 0 && j < TIERS.length)
      .map((j) => TIERS[j])
      .filter((d) => d !== a)
    b = band[Math.floor(rand() * band.length)]
  }
  return [a, b]
}

function shuffle(items: string[], rand: () => number): string[] {
  const order = [...items]
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[order[i], order[j]] = [order[j], order[i]]
  }
  return order
}

// 阵容逐日演化：上一届成员大概率留任（名次靠前留任概率稍高），人数在 1~4 间 ±1 随机游走
// （与真人报名数无关），缺口从池中未在场者随机补——整体只做少量替换，不整套换血。
function evolveLineup(rand: () => number, pool: string[], prevRanked: string[]): string[] {
  const cap = Math.min(4, pool.length)
  const prev = prevRanked.filter((e) => pool.includes(e))
  if (prev.length === 0) return shuffle(pool, rand).slice(0, Math.min(1 + Math.floor(rand() * 4), cap))
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
