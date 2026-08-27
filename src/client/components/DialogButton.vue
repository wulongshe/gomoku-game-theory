<script setup lang="ts">
withDefaults(defineProps<{ variant?: 'primary' | 'secondary' | 'danger' }>(), {
  variant: 'primary',
})

const variants = {
  primary:
    'bg-stone-800 text-white active:bg-stone-600 dark:bg-stone-200 dark:text-stone-900 dark:active:bg-stone-400',
  secondary:
    'bg-stone-200 text-stone-700 active:bg-stone-300 dark:bg-stone-700 dark:text-stone-200 dark:active:bg-stone-600',
  danger: 'bg-red-500 text-white active:bg-red-600',
}
</script>

<template>
  <button
    class="flex-1 cursor-pointer rounded-xl px-4 py-2.5 font-medium"
    :class="variants[variant]"
  >
    <slot />
  </button>
</template>
