<script setup lang="ts" generic="T extends string | number">
defineProps<{
  options: readonly T[]
  label: (option: T) => string
  disabled?: boolean
  // 单独置灰某些选项（整体 disabled 之外的细粒度控制）。
  optionDisabled?: (option: T) => boolean
}>()

const value = defineModel<T>()
</script>

<template>
  <div
    class="flex rounded-lg bg-stone-200 p-0.5 transition-opacity dark:bg-stone-700"
    :class="disabled && 'pointer-events-none opacity-50'"
  >
    <button
      v-for="option in options"
      :key="option"
      class="inline-flex h-7 flex-1 cursor-pointer items-center justify-center gap-1 rounded-md pb-px font-medium leading-none transition-colors"
      :class="[
        value === option
          ? 'bg-white text-stone-800 shadow-sm dark:bg-stone-900 dark:text-stone-100'
          : 'text-stone-500 dark:text-stone-400',
        optionDisabled?.(option) && 'pointer-events-none opacity-40',
      ]"
      :disabled="disabled || optionDisabled?.(option)"
      @click="value = option"
    >
      {{ label(option) }}
    </button>
  </div>
</template>
