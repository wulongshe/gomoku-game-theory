<script setup lang="ts">
import StoneGlyph from '~/components/StoneGlyph.vue'
import { STONE_PALETTE } from '~/utils/stones'
import type { Color } from '@gomoku/engine/melee'

defineProps<{ seat: Color; mooncake?: boolean }>()
</script>

<template>
  <svg viewBox="0 0 30 30" aria-hidden="true">
    <defs>
      <radialGradient :id="`seat-stone-${seat}`" cx="35%" cy="30%" r="80%">
        <stop offset="0%" :stop-color="STONE_PALETTE[seat].light" />
        <stop offset="100%" :stop-color="STONE_PALETTE[seat].dark" />
      </radialGradient>
    </defs>
    <g transform="translate(15 15)">
      <StoneGlyph :color="seat" :r="13.5" :gradient="`seat-stone-${seat}`" :mooncake="mooncake" />
    </g>
  </svg>
</template>
