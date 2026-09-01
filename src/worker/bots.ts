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

function botDifficulty(email: string): Difficulty {
  const tiers: Difficulty[] = ['easy', 'normal', 'normal', 'hard']
  return tiers[hashString(`diff:${email}`) % tiers.length]
}

function shuffled(dateKey: string, pool: string[]): { order: string[]; rand: () => number } {
  const rand = mulberry32(hashString(dateKey))
  const order = [...pool]
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[order[i], order[j]] = [order[j], order[i]]
  }
  return { order, rand }
}

// 留一个名额给补位 bot。
function lineupSize(rand: () => number, poolSize: number): number {
  return Math.max(0, Math.min(4 + Math.floor(rand() * 3), poolSize - 1))
}

export function dailyBots(dateKey: string, pool: string[]): TournamentBot[] {
  const { order, rand } = shuffled(dateKey, pool)
  const count = lineupSize(rand, order.length)
  return order.slice(0, count).map((email) => ({
    email,
    difficulty: botDifficulty(email),
    leadMs: Math.floor(rand() * REG_WINDOW_MS),
  }))
}

// 凑偶数用的补位 bot：不参与赛前注水，开赛瞬间才出现（像压哨报名的真人）。
export function parityBot(dateKey: string, pool: string[]): TournamentBot | null {
  const { order, rand } = shuffled(dateKey, pool)
  const email = order[lineupSize(rand, order.length)]
  return email ? { email, difficulty: botDifficulty(email), leadMs: 0 } : null
}

export function botRegistrations(
  dateKey: string,
  pool: string[],
  startsAt: number,
  now: number,
): TournamentBot[] {
  return dailyBots(dateKey, pool).filter((b) => startsAt - b.leadMs <= now)
}
