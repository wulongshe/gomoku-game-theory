<script setup lang="ts">
const model = defineModel<boolean>({ required: true })
</script>

<template>
  <label
    class="flex cursor-pointer items-center justify-between gap-3 select-none text-sm text-stone-700 dark:text-stone-200"
  >
    <slot />
    <input v-model="model" type="checkbox" class="peer sr-only" />
    <span
      class="relative h-4.5 w-8 shrink-0 rounded-full bg-stone-300 transition-colors peer-checked:bg-stone-800 after:absolute after:top-0.5 after:left-0.5 after:size-3.5 after:rounded-full after:bg-white after:shadow-sm after:transition-transform peer-checked:after:translate-x-3.5 dark:bg-stone-600 dark:peer-checked:bg-emerald-600"
    />
  </label>
</template>
