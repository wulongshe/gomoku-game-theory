<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useEventListener } from '@vueuse/core'
import IconChevronRight from '~/components/icons/IconChevronRight.vue'
import IconCross from '~/components/icons/IconCross.vue'
import { fullRules } from '@gomoku/branding'

const emit = defineEmits<{ close: [] }>()

const FULL_RULES = fullRules()

// 规则超出弹窗高度时提示可下滑，滚到接近底部即淡出。
const body = ref<HTMLElement>()
const scrollHint = ref(false)
function updateScrollHint() {
  const el = body.value
  scrollHint.value = !!el && el.scrollHeight - el.clientHeight - el.scrollTop > 48
}
onMounted(updateScrollHint)
useEventListener(body, 'scroll', updateScrollHint, { passive: true })
useEventListener(window, 'resize', updateScrollHint)
</script>

<template>
  <div
    class="fixed inset-0 z-10 flex items-center justify-center bg-black/40 p-6"
    @click.self="emit('close')"
  >
    <div
      class="relative flex max-h-[85dvh] w-full max-w-md flex-col gap-5 rounded-2xl bg-white p-6 shadow-lg dark:bg-stone-800"
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
      <div ref="body" class="flex flex-col gap-5 overflow-y-auto">
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
      <div
        class="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col items-center gap-0.5 rounded-b-2xl bg-gradient-to-t from-white via-white/70 to-transparent pb-1.5 pt-10 text-stone-500 transition-opacity duration-300 dark:from-stone-800 dark:via-stone-800/70 dark:text-stone-400"
        :class="scrollHint ? 'opacity-100' : 'opacity-0'"
      >
        <span class="text-xs">下滑查看更多</span>
        <IconChevronRight class="size-4 rotate-90 animate-bounce" />
      </div>
    </div>
  </div>
</template>
