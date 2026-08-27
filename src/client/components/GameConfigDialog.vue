<script setup lang="ts">
import IconCheck from '~/components/icons/IconCheck.vue'
import IconSpinner from '~/components/icons/IconSpinner.vue'
import { MODE_LABELS } from '~/constants/branding'
import { FRAME_OPTIONS, MODE_OPTIONS } from '@/shared/protocol'
import type { GameMode } from '@/engine/game'

defineProps<{
  title: string
  confirmText: string
  hint?: string
  multi?: boolean
  loading?: boolean
  disabled?: boolean
}>()
const emit = defineEmits<{ cancel: []; confirm: [] }>()

const frame = defineModel<number>('frame', { default: FRAME_OPTIONS[0] })
const mode = defineModel<GameMode>('mode', { default: MODE_OPTIONS[0] })
const frames = defineModel<number[]>('frames', { default: () => [] })
const modes = defineModel<GameMode[]>('modes', { default: () => [] })

function toggled<T>(current: T[], options: T[], option: T): T[] {
  const next = current.includes(option)
    ? current.filter((o) => o !== option)
    : options.filter((o) => current.includes(o) || o === option)
  return next.length ? next : current
}

function frameLabel(option: number) {
  return option ? `${option}s` : '不限'
}
</script>

<template>
  <div class="fixed inset-0 z-10 flex items-center justify-center bg-black/40 p-6">
    <div class="flex w-full max-w-xs flex-col gap-4 rounded-2xl bg-white p-6 shadow-lg dark:bg-stone-800">
      <p class="text-base font-semibold text-stone-800 dark:text-stone-100">{{ title }}</p>
      <div class="flex flex-col gap-3 text-sm">
        <div class="flex flex-col gap-2">
          <span class="text-center text-stone-500 dark:text-stone-400">每回合</span>
          <div class="flex rounded-lg bg-stone-200 p-0.5 dark:bg-stone-700" :class="multi && 'gap-0.5'">
            <template v-if="multi">
              <button
                v-for="option in FRAME_OPTIONS"
                :key="option"
                class="inline-flex h-7 flex-1 cursor-pointer items-center justify-center gap-1 rounded-md pb-px font-medium leading-none transition-colors"
                :class="frames.includes(option) ? 'bg-white text-stone-800 shadow-sm dark:bg-stone-900 dark:text-stone-100' : 'text-stone-500 dark:text-stone-400'"
                :disabled="disabled"
                @click="frames = toggled(frames, FRAME_OPTIONS, option)"
              >
                <span
                  class="flex size-3.5 items-center justify-center rounded-sm border transition-colors"
                  :class="frames.includes(option) ? 'border-emerald-600 bg-emerald-600' : 'border-stone-400 dark:border-stone-500'"
                >
                  <IconCheck v-if="frames.includes(option)" class="size-2.5 text-white" />
                </span>
                {{ frameLabel(option) }}
              </button>
            </template>
            <template v-else>
              <button
                v-for="option in FRAME_OPTIONS"
                :key="option"
                class="inline-flex h-7 flex-1 cursor-pointer items-center justify-center rounded-md pb-px font-medium leading-none transition-colors"
                :class="frame === option ? 'bg-white text-stone-800 shadow-sm dark:bg-stone-900 dark:text-stone-100' : 'text-stone-500 dark:text-stone-400'"
                @click="frame = option"
              >
                {{ frameLabel(option) }}
              </button>
            </template>
          </div>
        </div>
        <div class="flex flex-col gap-2">
          <span class="text-center text-stone-500 dark:text-stone-400">撞点后</span>
          <div class="flex rounded-lg bg-stone-200 p-0.5 dark:bg-stone-700" :class="multi && 'gap-0.5'">
            <template v-if="multi">
              <button
                v-for="option in MODE_OPTIONS"
                :key="option"
                class="inline-flex h-7 flex-1 cursor-pointer items-center justify-center gap-1 rounded-md pb-px font-medium leading-none transition-colors"
                :class="modes.includes(option) ? 'bg-white text-stone-800 shadow-sm dark:bg-stone-900 dark:text-stone-100' : 'text-stone-500 dark:text-stone-400'"
                :disabled="disabled"
                @click="modes = toggled(modes, MODE_OPTIONS, option)"
              >
                <span
                  class="flex size-3.5 items-center justify-center rounded-sm border transition-colors"
                  :class="modes.includes(option) ? 'border-emerald-600 bg-emerald-600' : 'border-stone-400 dark:border-stone-500'"
                >
                  <IconCheck v-if="modes.includes(option)" class="size-2.5 text-white" />
                </span>
                {{ MODE_LABELS[option] }}
              </button>
            </template>
            <template v-else>
              <button
                v-for="option in MODE_OPTIONS"
                :key="option"
                class="inline-flex h-7 flex-1 cursor-pointer items-center justify-center rounded-md pb-px font-medium leading-none transition-colors"
                :class="mode === option ? 'bg-white text-stone-800 shadow-sm dark:bg-stone-900 dark:text-stone-100' : 'text-stone-500 dark:text-stone-400'"
                @click="mode = option"
              >
                {{ MODE_LABELS[option] }}
              </button>
            </template>
          </div>
        </div>
      </div>
      <p v-if="hint" class="text-center text-xs text-stone-400 dark:text-stone-500">{{ hint }}</p>
      <div class="flex gap-2">
        <button
          class="flex-1 cursor-pointer rounded-xl bg-stone-200 px-4 py-2.5 font-medium text-stone-700 active:bg-stone-300 dark:bg-stone-700 dark:text-stone-200 dark:active:bg-stone-600"
          @click="emit('cancel')"
        >
          取消
        </button>
        <button
          class="flex-1 cursor-pointer rounded-xl bg-stone-800 px-4 py-2.5 font-medium text-white active:bg-stone-600 dark:bg-stone-200 dark:text-stone-900 dark:active:bg-stone-400"
          :disabled="loading"
          @click="emit('confirm')"
        >
          <span class="flex items-center justify-center gap-2">
            <IconSpinner v-if="loading" class="size-4" />
            <span>{{ confirmText }}</span>
          </span>
        </button>
      </div>
    </div>
  </div>
</template>
