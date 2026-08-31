import type { GameMode } from '@/engine/game'
import type { Difficulty } from '@/engine/ai'

export const TITLE = '博弈五子棋'
export const TAGLINE = '下棋，更是读心'
export const SUBTITLE = '经典五子棋 × 同时落子，每一手都是心理博弈'

export const MODE_LABELS: Record<GameMode, string> = {
  race: '抢点',
  forbidden: '禁点',
  minus: '负子',
}

export const DIFFICULTY_OPTIONS: Difficulty[] = ['easy', 'normal', 'hard', 'hell']

export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  easy: '简单',
  normal: '普通',
  hard: '困难',
  hell: '地狱',
}

// 地狱难度「加成」滑条默认值（5%~100%）；引擎读心置信度 = 加成 - 0.05。
export const DEFAULT_HELL_STRENGTH = 0.05

export function frameLabel(seconds: number): string {
  return seconds ? `${seconds}s` : '不限时'
}

export const TOURNAMENT_TITLE = '每日大赛'
export const TOURNAMENT_DESC = '每日 20:00 开赛 · 瑞士轮积分'

export function formatCountdown(totalSeconds: number): string {
  const s = Math.max(0, totalSeconds)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`
}

export const RULES = [
  {
    icon: '⚡',
    title: '同时落子，没有先手',
    text: '每回合限时选点，双方同时出手',
  },
  {
    icon: '🧠',
    title: '撞子博弈，读心制胜',
    text: '双方落同一点，该点变为禁点、负子或归先下者',
  },
  {
    icon: '⭐',
    title: '五连即胜，同五两消',
    text: '连成五子就赢，双方同时连五，连线棋子一起消失',
  },
]

export const FULL_RULES = [
  {
    title: '⚡ 同时落子',
    items: [
      '每回合限时 30/60/120 秒或不限时，双方各自秘密选点，双方都提交或时间到后同时落子',
      '时间到时未提交：有草稿则自动提交草稿，没有则本回合弃着',
      '对方提交前，已提交的一方仍可变更落点',
      '首回合双方只能落在中央 3×3 区域，且不能落天元（正中心）',
      '中途退出判负',
    ],
  },
  {
    title: '🧠 撞子',
    items: [
      '双方落在同一点即为撞子，按开局时选择的模式处理',
      '禁点模式：该点变为禁点，双方都无法再落子',
      '负子模式：化作负子，双方连线时都减 1',
      '抢点模式：先提交的一方得到该点，成为其棋子',
      '禁点连成五：整条禁点线清除，位置重新可用',
    ],
  },
  {
    title: '⭐ 胜负',
    items: [
      '任意方向连续棋子累计满 5 即胜，负子减 1',
      '棋盘下满仍无人连五则为和棋',
      '双方同时连五，连线棋子一起消失，对局继续',
    ],
  },
]
