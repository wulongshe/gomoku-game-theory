<script setup lang="ts">
defineProps<{ char: string; colors: string[] }>()
const emit = defineEmits<{ dismiss: [] }>()
</script>

<template>
  <div
    class="absolute inset-0 flex cursor-pointer flex-col items-center justify-center"
    role="button"
    aria-label="关闭结果浮层"
    @click="emit('dismiss')"
  >
    <svg
      viewBox="0 0 144 144"
      class="w-36 animate-[stamp_0.4s_ease-out] drop-shadow-[0_6px_16px_rgba(28,25,23,0.45)]"
      :style="{ rotate: '-8deg' }"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="result-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" :stop-color="colors[0]" />
          <stop offset="100%" :stop-color="colors[1]" />
        </linearGradient>
      </defs>
      <text
        x="72"
        y="72"
        text-anchor="middle"
        dominant-baseline="central"
        font-size="128"
        font-weight="900"
        fill="url(#result-grad)"
        style="font-family: STKaiti, KaiTi, 'Noto Serif SC', serif"
      >
        {{ char }}
      </text>
    </svg>
    <span class="mt-2 rounded-full bg-black/30 px-3 py-1 text-xs text-white">
      点击查看棋盘
    </span>
  </div>
</template>
