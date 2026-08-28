<script setup lang="ts">
import type { Urgency } from '~/composables/useFrameClock'

defineProps<{ remainingRatio: number; urgency: Urgency }>()
</script>

<template>
  <div class="h-1.5 overflow-hidden rounded-full bg-stone-300/70 dark:bg-stone-700/70">
    <div
      class="h-full rounded-full transition-[width] duration-200 ease-linear"
      :class="{
        'bg-stone-500 dark:bg-stone-400': urgency === 'calm',
        'bg-amber-500': urgency === 'warning',
        'bg-red-500': urgency === 'critical',
      }"
      :style="{ width: `${remainingRatio * 100}%` }"
    />
  </div>
</template>
