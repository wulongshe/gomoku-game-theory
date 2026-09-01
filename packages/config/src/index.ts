import type { GameMode } from '@gomoku/engine/game'
import type { Difficulty } from '@gomoku/engine/ai'

// 人机对战本地单步结算，抢点撞子只能随机归属，沦为运气，故不开放给 AI
export const AI_MODE_OPTIONS: GameMode[] = ['forbidden', 'minus']

export const DIFFICULTY_OPTIONS: Difficulty[] = ['easy', 'normal', 'hard', 'expert']

// 专家难度等级 1~20；引擎读心置信度 read = (level - 1) / 20（1 级纯盲搜）。
export const EXPERT_LEVEL_MIN = 1
export const EXPERT_LEVEL_MAX = 20
export const DEFAULT_EXPERT_LEVEL = EXPERT_LEVEL_MIN

export function expertRead(level: number): number {
  return (level - 1) / 20
}

export function clampExpertLevel(raw: number): number {
  if (!Number.isFinite(raw)) return DEFAULT_EXPERT_LEVEL
  return Math.min(EXPERT_LEVEL_MAX, Math.max(EXPERT_LEVEL_MIN, Math.round(raw)))
}
