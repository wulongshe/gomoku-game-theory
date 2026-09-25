import type { Difficulty } from '@gomoku/engine/ai'
import type { Color } from '@gomoku/engine/melee'

export const TITLE = '博弈五子棋'
export const TAGLINE = '下棋，更是读心'
export const SUBTITLE = '经典五子棋 × 同时落子，每一手都是心理博弈'

export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  easy: '简单',
  normal: '普通',
  hard: '困难',
  master: '大师',
}

export function rules() {
  return [
    {
      icon: '⚡',
      title: '同时落子，没有先手',
      text: '每回合秘密选点，双方同时出手',
    },
    {
      icon: '🧠',
      title: '撞子博弈，读心制胜',
      text: '双方同一落点，该点变为禁点',
    },
    {
      icon: '⭐',
      title: '五连即胜，同五两消',
      text: '连成五子就赢，同时连五则连线棋子消失',
    },
  ]
}

export type RuleAudience = 'pvp' | 'ai'

// 完整规则按受众过滤：联机（pvp）含限时/草稿/变更/退出判负等条目，
// 人机（ai）恒不限时、单步提交即结算，换用对应表述。
const RULE_SECTIONS: { title: string; items: { text: string; only?: RuleAudience }[] }[] = [
  {
    title: '⚡ 落子',
    items: [
      {
        text: '每回合限时 30/60 秒或不限时，双方各自秘密选点，双方都提交或时间到后同时落子',
        only: 'pvp',
      },
      { text: '你与 AI 各自秘密选点，提交后同时落子', only: 'ai' },
      { text: '时间到时未提交：有草稿则自动提交草稿，没有则本回合弃着', only: 'pvp' },
      { text: '对方提交前，已提交的一方仍可变更落点', only: 'pvp' },
      { text: '首回合双方只能落在中央 3×3 区域，且不能落天元（正中心）' },
    ],
  },
  {
    title: '🧠 撞子',
    items: [
      { text: '双方落在同一点即为撞子，该点变为禁点，双方都无法再落子' },
      { text: '禁点连成五：整条禁点线清除，位置重新可用' },
    ],
  },
  {
    title: '⭐ 胜负',
    items: [
      { text: '任意方向连续五子即胜' },
      { text: '棋盘下满仍无人连五则为和棋' },
      { text: '双方同时连五，连线棋子一起消失，对局继续' },
      { text: '中途退出判负', only: 'pvp' },
    ],
  },
]

export function fullRules(audience: RuleAudience = 'pvp'): { title: string; items: string[] }[] {
  return RULE_SECTIONS.map(({ title, items }) => ({
    title,
    items: items.filter((item) => !item.only || item.only === audience).map((item) => item.text),
  }))
}

export const COLOR_LABELS: Record<Color, string> = {
  black: '黑',
  white: '白',
  purple: '紫',
  yellow: '黄',
  blue: '蓝',
}

export const MELEE_TITLE = '中秋特辑'
export const MELEE_SUBTITLE = '3~5 人月饼大乱斗'

export function meleeRules(): { title: string; items: string[] }[] {
  return [
    {
      title: '🥮 落子',
      items: [
        '所有人每回合各自秘密选点，全员提交或时间到后同时落子',
        '首回合只能落在中央 3×3 区域，且不能落天元',
        '两人以上撞在同一点，该点变为禁点；禁点连成五整线清除',
      ],
    },
    {
      title: '🏁 完赛',
      items: [
        '任意方向连成五子即完赛，按先后顺序排名，月饼留在盘上',
        '多人同一回合连五，连线一起消失，谁都不算完赛',
        '只剩一人或无人能再连五时终局，剩下的人垫底',
        '中途退出即离场，不计名次',
      ],
    },
  ]
}
