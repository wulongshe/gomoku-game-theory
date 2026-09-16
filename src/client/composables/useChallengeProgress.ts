import { computed } from 'vue'
import { useStorage } from '@vueuse/core'
import { DIFFICULTY_OPTIONS } from '@gomoku/config'
import type { Difficulty } from '@gomoku/engine/ai'
import { CHALLENGE_CLEARS_PREFIX } from '~/constants/storage'

// 每期残局已通过的难度记在本地；难度依次开启，登录用户再并入服务端记录。
export function useChallengeProgress(id: string) {
  const cleared = useStorage<Difficulty[]>(`${CHALLENGE_CLEARS_PREFIX}${id}`, [])

  function unlocked(difficulty: Difficulty): boolean {
    const index = DIFFICULTY_OPTIONS.indexOf(difficulty)
    return index === 0 || cleared.value.includes(DIFFICULTY_OPTIONS[index - 1])
  }

  const highestUnlocked = computed(
    () => [...DIFFICULTY_OPTIONS].reverse().find((d) => unlocked(d)) ?? DIFFICULTY_OPTIONS[0],
  )

  function markCleared(difficulty: Difficulty) {
    if (!cleared.value.includes(difficulty)) cleared.value = [...cleared.value, difficulty]
  }

  function merge(difficulties: Difficulty[]) {
    for (const difficulty of difficulties) markCleared(difficulty)
  }

  return { cleared, unlocked, highestUnlocked, markCleared, merge }
}
