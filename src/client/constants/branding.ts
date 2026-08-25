import type { GameMode } from '@/engine/game'

export const TITLE = '博弈五子棋'
export const TAGLINE = '下棋，更是读心'
export const SUBTITLE = '经典五子棋 × 同时落子，每一手都是心理博弈'

export const MODE_LABELS: Record<GameMode, string> = { forbidden: '禁点', half: '半子' }

export const RULES = [
  {
    icon: '⚡',
    title: '同时落子，没有先手',
    text: '每回合 30/60 秒，双方同时出手',
  },
  {
    icon: '🧠',
    title: '撞点博弈，读心制胜',
    text: '双方落同一点，该点变为禁点或双方各占一半',
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
      '每回合限时 30/60 秒，双方各自秘密选点，双方都提交或时间到后同时落子',
      '时间到时未提交：有草稿则自动提交草稿，没有则本回合弃着',
      '对方提交前，已提交的一方仍可变更落点',
      '首回合双方只能落在中央 3×3 区域，且不能落天元（正中心）',
      '中途退出判负',
    ],
  },
  {
    title: '🧠 撞点',
    items: [
      '双方落在同一点即为撞点，按开局时选择的模式处理',
      '禁点模式：该点变为禁点，双方都无法再落子',
      '半子模式：化作太极半子，双方各占一半',
      '禁点连成五：整条禁点线清除，位置重新可用',
    ],
  },
  {
    title: '⭐ 胜负',
    items: [
      '任意方向连续棋子累计满 5 即胜，半子算 0.5（5 或 5.5 都算赢）',
      '棋盘下满仍无人连五则为和棋',
      '双方同时连五，连线棋子一起消失，对局继续',
    ],
  },
]
