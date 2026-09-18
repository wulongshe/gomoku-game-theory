import Taro from '@tarojs/taro'
import { DIFFICULTY_OPTIONS } from '@gomoku/config'
import type { Difficulty } from '@gomoku/engine/ai'

const DIFFICULTY_KEY = 'ai-difficulty'

export function loadDifficulty(): Difficulty {
  try {
    const saved = Taro.getStorageSync(DIFFICULTY_KEY) as Difficulty
    return DIFFICULTY_OPTIONS.includes(saved) ? saved : 'normal'
  } catch {
    return 'normal'
  }
}

export function saveDifficulty(difficulty: Difficulty): void {
  try {
    Taro.setStorageSync(DIFFICULTY_KEY, difficulty)
  } catch {
    // 存储不可用时忽略，仅影响下次默认选项。
  }
}
