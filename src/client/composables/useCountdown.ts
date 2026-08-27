import { computed, type Ref } from 'vue'
import { useTimestamp } from '@vueuse/core'

export function useCountdown(deadline: Ref<number | null>, max?: Ref<number>) {
  const now = useTimestamp({ interval: 250 })
  return computed(() => {
    if (deadline.value === null) return null
    const left = Math.max(0, Math.ceil((deadline.value - now.value) / 1000))
    return max ? Math.min(max.value, left) : left
  })
}
