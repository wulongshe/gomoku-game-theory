<script setup lang="ts">
import IconCross from '~/components/icons/IconCross.vue'
import { fullRules } from '@gomoku/branding'

const emit = defineEmits<{ close: [] }>()

const FULL_RULES = fullRules()
</script>

<template>
  <div
    class="fixed inset-0 z-10 flex items-center justify-center bg-black/40 p-6"
    @click.self="emit('close')"
  >
    <div
      class="flex max-h-[85dvh] w-full max-w-md flex-col gap-5 rounded-2xl bg-white p-6 shadow-lg dark:bg-stone-800"
    >
      <div class="flex items-center justify-between">
        <p class="text-lg font-semibold text-stone-800 dark:text-stone-100">游戏规则</p>
        <button
          class="cursor-pointer p-1 text-stone-400 hover:text-stone-600 active:text-stone-600 dark:text-stone-500 dark:hover:text-stone-300 dark:active:text-stone-300"
          aria-label="关闭"
          @click="emit('close')"
        >
          <IconCross class="size-4" />
        </button>
      </div>
      <div class="flex flex-col gap-5 overflow-y-auto">
        <div v-for="section in FULL_RULES" :key="section.title" class="flex flex-col gap-2">
          <p class="text-sm font-semibold text-stone-800 dark:text-stone-100">{{ section.title }}</p>
          <ul class="flex flex-col gap-1.5 text-sm text-stone-500 dark:text-stone-400">
            <li v-for="item in section.items" :key="item" class="flex gap-2">
              <span class="text-stone-300 dark:text-stone-600">•</span>
              <span>{{ item }}</span>
            </li>
          </ul>
        </div>
      </div>
    </div>
  </div>
</template>
