<script setup lang="ts">
defineProps<{ title: string }>()
const emit = defineEmits<{ dismiss: [] }>()
</script>

<template>
  <div
    class="fixed inset-0 z-10 flex items-center justify-center bg-black/40 p-6"
    @click.self="emit('dismiss')"
  >
    <div class="flex w-full max-w-xs flex-col gap-4 rounded-2xl bg-white p-6 shadow-lg dark:bg-stone-800">
      <p class="text-base font-semibold text-stone-800 dark:text-stone-100">{{ title }}</p>
      <slot />
    </div>
  </div>
</template>
