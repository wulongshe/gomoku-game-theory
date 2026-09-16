<script setup lang="ts" generic="T extends string | number">
import IconCheck from '~/components/icons/IconCheck.vue'

const props = defineProps<{
  options: readonly T[]
  label: (option: T) => string
  multi?: boolean
  disabled?: boolean
  // 单独置灰某些选项（整体 disabled 之外的细粒度控制）。
  optionDisabled?: (option: T) => boolean
}>()

const value = defineModel<T>()
const values = defineModel<T[]>('values', { default: () => [] })

function isActive(option: T): boolean {
  return props.multi ? values.value.includes(option) : value.value === option
}

// 多选至少保留一项：取消最后一项时忽略；新增时按 options 顺序归并，保持展示次序稳定。
function pick(option: T): void {
  if (props.disabled || props.optionDisabled?.(option)) return
  if (!props.multi) {
    value.value = option
    return
  }
  const next = values.value.includes(option)
    ? values.value.filter((o) => o !== option)
    : props.options.filter((o) => values.value.includes(o) || o === option)
  if (next.length) values.value = next
}
</script>

<template>
  <div
    class="flex rounded-lg bg-stone-200 p-0.5 transition-opacity dark:bg-stone-700"
    :class="[multi && 'gap-0.5', disabled && 'pointer-events-none opacity-50']"
  >
    <button
      v-for="option in options"
      :key="option"
      class="inline-flex h-7 flex-1 items-center justify-center gap-1 rounded-md pb-px font-medium leading-none transition-colors"
      :class="[
        isActive(option)
          ? 'bg-white text-stone-800 shadow-sm dark:bg-stone-900 dark:text-stone-100'
          : 'text-stone-500 dark:text-stone-400',
        optionDisabled?.(option) ? 'cursor-not-allowed opacity-40' : 'cursor-pointer',
      ]"
      :disabled="disabled || optionDisabled?.(option)"
      @click="pick(option)"
    >
      <span
        v-if="multi"
        class="flex size-3.5 items-center justify-center rounded-sm border transition-colors"
        :class="isActive(option) ? 'border-emerald-600 bg-emerald-600' : 'border-stone-400 dark:border-stone-500'"
      >
        <IconCheck v-if="isActive(option)" class="size-2.5 text-white" />
      </span>
      <slot name="option" :option="option">{{ label(option) }}</slot>
    </button>
  </div>
</template>
