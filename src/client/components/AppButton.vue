<script setup lang="ts">
defineProps<{ secondary?: boolean }>()
</script>

<template>
  <button
    class="cursor-pointer rounded-xl px-6 py-3 text-lg font-medium shadow-sm transition-transform active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100"
    :class="
      secondary
        ? 'border border-stone-300 bg-white/80 text-stone-700 dark:border-stone-600 dark:bg-stone-800/80 dark:text-stone-200'
        : 'bg-stone-800 text-white active:bg-stone-600 dark:bg-stone-200 dark:text-stone-900 dark:active:bg-stone-400'
    "
  >
    <slot />
  </button>
</template>
