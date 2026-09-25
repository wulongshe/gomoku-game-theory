<script setup lang="ts">
import { computed } from 'vue'
import { mooncakePath, STONE_PALETTE } from '~/utils/stones'
import type { Color } from '@gomoku/engine/melee'

// 以原点为中心画一颗棋子；渐变由所在 svg 的 defs 提供（id 为 gradient）。
const props = defineProps<{ color: Color; r: number; gradient: string; mooncake?: boolean }>()

const path = computed(() => mooncakePath(props.r))
const palette = computed(() => STONE_PALETTE[props.color])
</script>

<template>
  <g v-if="mooncake" :stroke="palette.edge" stroke-linejoin="round">
    <path :d="path" :fill="`url(#${gradient})`" stroke-width="1" />
    <circle :r="r * 0.6" fill="none" stroke-width="1.2" opacity="0.7" />
    <circle
      v-for="i in 4"
      :key="i"
      :cx="Math.cos((i * Math.PI) / 2) * r * 0.3"
      :cy="Math.sin((i * Math.PI) / 2) * r * 0.3"
      :r="r * 0.11"
      :fill="palette.edge"
      stroke="none"
      opacity="0.7"
    />
  </g>
  <circle
    v-else
    :r="r"
    :fill="`url(#${gradient})`"
    :stroke="color === 'white' ? palette.edge : 'none'"
    stroke-width="1"
  />
</template>
