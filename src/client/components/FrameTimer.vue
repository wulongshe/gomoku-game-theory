<script setup lang="ts">
import type { Urgency } from '~/composables/useFrameClock'

defineProps<{
  frameSeconds: number
  secondsLeft: number | null
  elapsedSeconds: number
  urgency: Urgency
}>()
</script>

<template>
  <span
    class="justify-self-end text-base font-semibold tabular-nums"
    :class="{
      'text-stone-600 dark:text-stone-300': urgency === 'calm',
      'text-amber-600 dark:text-amber-400': urgency === 'warning',
      'animate-pulse text-red-600 dark:text-red-400': urgency === 'critical',
    }"
  >
    <template v-if="frameSeconds === 0"
      >{{ elapsedSeconds }}s/<span class="relative top-[0.05em]">∞</span></template
    ><template v-else>{{ secondsLeft ?? 0 }}s/{{ frameSeconds }}s</template>
  </span>
</template>
