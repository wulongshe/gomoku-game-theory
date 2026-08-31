import Taro from '@tarojs/taro'
import type { GameState } from '@gomoku/engine/game'

const GAME_KEY = 'ai-game'

export function saveGame(state: GameState): void {
  try {
    Taro.setStorageSync(GAME_KEY, state)
  } catch {
    // 存储不可用时忽略，仅影响重开小程序后的续局。
  }
}

export function loadGame(mode: string): GameState | null {
  try {
    const saved = Taro.getStorageSync(GAME_KEY) as GameState | null
    return saved && saved.mode === mode ? saved : null
  } catch {
    return null
  }
}
