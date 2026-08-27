<script setup lang="ts">
import type { Seat } from '@/engine/game'

defineProps<{ seat: Seat }>()
</script>

<template>
  <svg viewBox="0 0 30 30" aria-hidden="true">
    <defs>
      <radialGradient :id="`seat-stone-${seat}`" cx="35%" cy="30%" r="80%">
        <stop offset="0%" :stop-color="seat === 'black' ? '#5a5a5a' : '#ffffff'" />
        <stop offset="100%" :stop-color="seat === 'black' ? '#111111' : '#d6d3d1'" />
      </radialGradient>
    </defs>
    <circle
      cx="15"
      cy="15"
      r="13.5"
      :fill="`url(#seat-stone-${seat})`"
      :stroke="seat === 'white' ? '#a8a29e' : 'none'"
      stroke-width="1"
    />
  </svg>
</template>
