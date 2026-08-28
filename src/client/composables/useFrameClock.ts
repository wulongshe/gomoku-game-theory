import { computed, toValue, type MaybeRefOrGetter, type Ref } from 'vue'
import { useTimestamp } from '@vueuse/core'

export type Urgency = 'calm' | 'warning' | 'critical'

// 帧计时的共享派生态：倒计时 secondsLeft、剩余比例、紧迫度、正计时 elapsedSeconds、是否已过期。
// deadline 为 null（不限时）时倒计时无期限；elapsedSeconds 仅在 active 时累加。
export function useFrameClock(
  deadline: Ref<number | null>,
  frameSeconds: MaybeRefOrGetter<number>,
  frameStart: Ref<number | null>,
  active: MaybeRefOrGetter<boolean>,
) {
  const now = useTimestamp({ interval: 250 })

  const secondsLeft = computed(() => {
    if (deadline.value === null) return null
    const left = Math.max(0, Math.ceil((deadline.value - now.value) / 1000))
    return Math.min(toValue(frameSeconds), left)
  })

  const remainingRatio = computed(() => {
    if (deadline.value === null) return 0
    return Math.min(1, Math.max(0, (deadline.value - now.value) / (toValue(frameSeconds) * 1000)))
  })

  const urgency = computed<Urgency>(() => {
    if (secondsLeft.value === null) return 'calm'
    if (secondsLeft.value <= 5) return 'critical'
    if (remainingRatio.value <= 1 / 3) return 'warning'
    return 'calm'
  })

  const elapsedSeconds = computed(() => {
    if (frameStart.value === null || !toValue(active)) return 0
    return Math.max(0, Math.floor((now.value - frameStart.value) / 1000))
  })

  const overdue = computed(() => deadline.value !== null && now.value >= deadline.value)

  return { secondsLeft, remainingRatio, urgency, elapsedSeconds, overdue }
}
