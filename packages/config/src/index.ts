import type { GameMode } from '@gomoku/engine/game'
import type { Difficulty } from '@gomoku/engine/ai'

// 人机对战本地单步结算，抢点撞子只能随机归属，沦为运气，故不开放给 AI
export const AI_MODE_OPTIONS: GameMode[] = ['forbidden', 'minus']

export const DIFFICULTY_OPTIONS: Difficulty[] = ['easy', 'normal', 'hard', 'master']
