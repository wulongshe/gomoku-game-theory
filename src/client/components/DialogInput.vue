<script setup lang="ts">
const model = defineModel<string>({ required: true })
</script>

<template>
  <input
    v-model="model"
    class="w-full rounded-xl border border-stone-300 bg-white px-4 py-2.5 text-sm text-stone-800 placeholder:text-stone-400 focus:border-stone-500 focus:outline-none dark:border-stone-600 dark:bg-stone-700/40 dark:text-stone-100 dark:placeholder:text-stone-500 dark:focus:border-stone-400"
  />
</template>
