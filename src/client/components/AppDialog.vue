<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import IconCross from '~/components/icons/IconCross.vue'

withDefaults(defineProps<{ title: string; closable?: boolean }>(), { closable: true })
const emit = defineEmits<{ close: [] }>()

// 内容高度变化时平滑过渡：实测内容高度写入外框（height:auto 不可过渡，故用具体像素值）。
// 底部 footer 固定贴底，正文区高度不足时裁掉溢出，让按钮随外框底边平滑移动、不跳动。
const body = ref<HTMLElement>()
const footer = ref<HTMLElement>()
const height = ref<string>('auto')
let observer: ResizeObserver | undefined

function measure() {
  const total = (body.value?.offsetHeight ?? 0) + (footer.value?.offsetHeight ?? 0)
  if (total) height.value = `${total}px`
}

onMounted(() => {
  // 首帧直接落到实测高度（auto→px 不触发过渡），之后的 px→px 变化才走动画。
  measure()
  observer = new ResizeObserver(measure)
  if (body.value) observer.observe(body.value)
  if (footer.value) observer.observe(footer.value)
})

onBeforeUnmount(() => observer?.disconnect())
</script>

<template>
  <div class="fixed inset-0 z-10 flex items-center justify-center bg-black/40 p-6">
    <div
      class="flex w-full max-w-xs flex-col overflow-hidden rounded-2xl bg-white shadow-lg transition-[height] duration-300 ease-out dark:bg-stone-800"
      :style="{ height }"
    >
      <div class="min-h-0 flex-1 overflow-hidden">
        <div ref="body" class="flex flex-col gap-4" :class="$slots.footer ? 'px-6 pt-6 pb-4' : 'p-6'">
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
      <div v-if="$slots.footer" ref="footer" class="flex flex-col px-6 pb-6">
        <slot name="footer" />
      </div>
    </div>
  </div>
</template>
