<script setup lang="ts">
import IconCross from '~/components/icons/IconCross.vue'

withDefaults(defineProps<{ title: string; closable?: boolean }>(), { closable: true })
const emit = defineEmits<{ close: [] }>()
</script>

<template>
  <div class="fixed inset-0 z-10 flex items-center justify-center bg-black/40 p-6">
    <div class="flex w-full max-w-xs flex-col gap-4 rounded-2xl bg-white p-6 shadow-lg dark:bg-stone-800">
      <div class="flex items-center justify-between">
        <p class="text-base font-semibold text-stone-800 dark:text-stone-100">{{ title }}</p>
        <button
          v-if="closable"
          class="-mr-4 -mt-8 cursor-pointer p-1 text-stone-400 hover:text-stone-600 active:text-stone-600 dark:text-stone-500 dark:hover:text-stone-300 dark:active:text-stone-300"
          aria-label="关闭"
          @click="emit('close')"
        >
          <IconCross class="size-4" />
        </button>
      </div>
      <slot />
    </div>
  </div>
</template>
