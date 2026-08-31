import type { Difficulty } from '@gomoku/engine/ai'
import type { GameMode } from '@gomoku/engine/game'

export const MODE_OPTIONS: GameMode[] = ['forbidden', 'minus']

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

// 地狱难度「棋力」滑条默认值（5%~100%）；引擎读心置信度 = 棋力 - 0.05。
export const DEFAULT_HELL_STRENGTH = 0.05
