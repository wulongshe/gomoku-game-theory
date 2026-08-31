import Taro from '@tarojs/taro'
import { AI_MODE_OPTIONS, DEFAULT_HELL_STRENGTH, DIFFICULTY_OPTIONS } from '@gomoku/branding'
import type { Difficulty } from '@gomoku/engine/ai'
import type { GameMode } from '@gomoku/engine/game'

export interface GameConfig {
  mode: GameMode
  difficulty: Difficulty
  strength: number
}

const CONFIG_KEY = 'ai-config'

const DEFAULT_CONFIG: GameConfig = {
  mode: 'forbidden',
  difficulty: 'normal',
  strength: DEFAULT_HELL_STRENGTH,
}

export function loadConfig(): GameConfig {
  try {
    const saved = Taro.getStorageSync(CONFIG_KEY) as Partial<GameConfig> | null
    if (!saved) return DEFAULT_CONFIG
    return {
      mode: AI_MODE_OPTIONS.includes(saved.mode as GameMode) ? (saved.mode as GameMode) : DEFAULT_CONFIG.mode,
      difficulty: DIFFICULTY_OPTIONS.includes(saved.difficulty as Difficulty)
        ? (saved.difficulty as Difficulty)
        : DEFAULT_CONFIG.difficulty,
      strength:
        typeof saved.strength === 'number' && saved.strength >= 0.05 && saved.strength <= 1
          ? saved.strength
          : DEFAULT_CONFIG.strength,
    }
  } catch {
    return DEFAULT_CONFIG
  }
}

export function saveConfig(config: GameConfig): void {
  try {
    Taro.setStorageSync(CONFIG_KEY, config)
  } catch {
    // 存储不可用时忽略，仅影响下次默认选项。
  }
}
