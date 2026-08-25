<script setup lang="ts">
import IconCross from '~/components/icons/IconCross.vue'
import { FULL_RULES } from '~/constants/branding'

const emit = defineEmits<{ close: [] }>()
</script>

<template>
  <div
    class="fixed inset-0 z-10 flex items-center justify-center bg-black/40 p-6"
    @click.self="emit('close')"
  >
    <div
      class="flex max-h-[85dvh] w-full max-w-md flex-col gap-5 overflow-y-auto rounded-2xl bg-white p-6 shadow-lg"
    >
      <div class="flex items-center justify-between">
        <p class="text-lg font-semibold text-stone-800">游戏规则</p>
        <button
          class="cursor-pointer p-1 text-stone-400 hover:text-stone-600 active:text-stone-600"
          aria-label="关闭"
          @click="emit('close')"
        >
          <IconCross class="size-4" />
        </button>
      </div>
      <div v-for="section in FULL_RULES" :key="section.title" class="flex flex-col gap-2">
        <p class="text-sm font-semibold text-stone-800">{{ section.title }}</p>
        <ul class="flex flex-col gap-1.5 text-sm text-stone-500">
          <li v-for="item in section.items" :key="item" class="flex gap-2">
            <span class="text-stone-300">•</span>
            <span>{{ item }}</span>
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>
