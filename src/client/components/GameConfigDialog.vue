<script setup lang="ts">
import { computed } from 'vue'
import AppDialog from '~/components/AppDialog.vue'
import DialogButton from '~/components/DialogButton.vue'
import IconCheck from '~/components/icons/IconCheck.vue'
import IconSpinner from '~/components/icons/IconSpinner.vue'
import { DIFFICULTY_LABELS, MODE_LABELS } from '~/constants/branding'
import { FRAME_OPTIONS, MODE_OPTIONS } from '@/shared/protocol'
import type { GameMode } from '@/engine/game'
import type { Difficulty } from '@/engine/ai'

withDefaults(
  defineProps<{
    title: string
    confirmText: string
    hint?: string
    multi?: boolean
    loading?: boolean
    disabled?: boolean
    showFrame?: boolean
    modeOptions?: GameMode[]
    difficulties?: Difficulty[]
  }>(),
  { modeOptions: () => MODE_OPTIONS, showFrame: true },
)
const emit = defineEmits<{ cancel: []; confirm: [] }>()

const frame = defineModel<number>('frame', { default: FRAME_OPTIONS[0] })
const mode = defineModel<GameMode>('mode', { default: MODE_OPTIONS[0] })
const frames = defineModel<number[]>('frames', { default: () => [] })
const modes = defineModel<GameMode[]>('modes', { default: () => [] })
const difficulty = defineModel<Difficulty>('difficulty', { default: 'normal' })
const slip = defineModel<number>('slip', { default: 0.5 })
// 展示为「难度」：难度 + slip（放水概率）= 1，故越往右放水越少、AI 越强。
// 滑条视觉范围 0~1，但 0/1 不可选，拖到端点时夹回 0.05/0.95。
const difficultyLevel = computed(() => Math.round((1 - slip.value) * 20) / 20)

// 已选比例决定填充长度与色相：低难度偏绿、高难度偏红。
const sliderStyle = computed(() => ({
  '--pct': `${((difficultyLevel.value - 0.05) / 0.9) * 100}%`,
  '--fill': `hsl(${(1 - difficultyLevel.value) * 130}deg 68% 45%)`,
}))

function onSlide(event: Event) {
  const level = (event.target as HTMLInputElement).valueAsNumber
  slip.value = Math.round((1 - level) * 20) / 20
}

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
  <AppDialog :title="title" @close="emit('cancel')">
    <div class="flex flex-col gap-3 text-sm">
      <div v-if="showFrame" class="flex flex-col gap-2">
        <span class="text-center text-stone-500 dark:text-stone-400">每回合</span>
        <div
          class="flex rounded-lg bg-stone-200 p-0.5 transition-opacity dark:bg-stone-700"
          :class="[multi && 'gap-0.5', disabled && 'pointer-events-none opacity-50']"
        >
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
              :disabled="disabled"
              @click="frame = option"
            >
              {{ frameLabel(option) }}
            </button>
          </template>
        </div>
      </div>
      <div class="flex flex-col gap-2">
        <span class="text-center text-stone-500 dark:text-stone-400">撞子后</span>
        <div
          class="flex rounded-lg bg-stone-200 p-0.5 transition-opacity dark:bg-stone-700"
          :class="[multi && 'gap-0.5', disabled && 'pointer-events-none opacity-50']"
        >
          <template v-if="multi">
            <button
              v-for="option in modeOptions"
              :key="option"
              class="inline-flex h-7 flex-1 cursor-pointer items-center justify-center gap-1 rounded-md pb-px font-medium leading-none transition-colors"
              :class="modes.includes(option) ? 'bg-white text-stone-800 shadow-sm dark:bg-stone-900 dark:text-stone-100' : 'text-stone-500 dark:text-stone-400'"
              :disabled="disabled"
              @click="modes = toggled(modes, modeOptions, option)"
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
              v-for="option in modeOptions"
              :key="option"
              class="inline-flex h-7 flex-1 cursor-pointer items-center justify-center rounded-md pb-px font-medium leading-none transition-colors"
              :class="mode === option ? 'bg-white text-stone-800 shadow-sm dark:bg-stone-900 dark:text-stone-100' : 'text-stone-500 dark:text-stone-400'"
              :disabled="disabled"
              @click="mode = option"
            >
              {{ MODE_LABELS[option] }}
            </button>
          </template>
        </div>
      </div>
      <div v-if="difficulties" class="flex flex-col gap-2">
        <span class="text-center text-stone-500 dark:text-stone-400">难度</span>
        <div class="flex rounded-lg bg-stone-200 p-0.5 dark:bg-stone-700">
          <button
            v-for="option in difficulties"
            :key="option"
            class="inline-flex h-7 flex-1 cursor-pointer items-center justify-center rounded-md pb-px font-medium leading-none transition-colors"
            :class="difficulty === option ? 'bg-white text-stone-800 shadow-sm dark:bg-stone-900 dark:text-stone-100' : 'text-stone-500 dark:text-stone-400'"
            @click="difficulty = option"
          >
            {{ DIFFICULTY_LABELS[option] }}
          </button>
        </div>
      </div>
      <div v-if="difficulties && difficulty === 'hell'" class="flex flex-col gap-2">
        <span class="text-center text-stone-500 dark:text-stone-400">难度值 {{ Math.round(difficultyLevel * 100) }}%</span>
        <input
          type="range"
          min="0.05"
          max="0.95"
          step="0.05"
          :value="difficultyLevel"
          :style="sliderStyle"
          class="level-range w-full cursor-pointer"
          @input="onSlide"
        />
      </div>
    </div>
    <p v-if="hint" class="text-center text-xs text-stone-400 dark:text-stone-500">{{ hint }}</p>
    <div class="flex">
      <DialogButton @click="emit('confirm')">
        <IconSpinner v-if="loading" class="size-4" />
        {{ confirmText }}
      </DialogButton>
    </div>
  </AppDialog>
</template>

<style scoped>
.level-range {
  --track: #e7e5e4;
  appearance: none;
  -webkit-appearance: none;
  height: 0.5rem;
  border-radius: 9999px;
  background: linear-gradient(to right, var(--fill) var(--pct), var(--track) var(--pct));
}
.level-range::-webkit-slider-thumb {
  appearance: none;
  -webkit-appearance: none;
  height: 1.15rem;
  width: 1.15rem;
  border-radius: 9999px;
  background: #fff;
  border: 3px solid var(--fill);
  box-shadow: 0 1px 3px rgb(0 0 0 / 0.25);
  transition: border-color 0.15s;
}
.level-range::-moz-range-track {
  height: 0.5rem;
  border-radius: 9999px;
  background: transparent;
}
.level-range::-moz-range-thumb {
  height: 1.15rem;
  width: 1.15rem;
  border: 3px solid var(--fill);
  border-radius: 9999px;
  background: #fff;
  box-shadow: 0 1px 3px rgb(0 0 0 / 0.25);
}
@media (prefers-color-scheme: dark) {
  .level-range {
    --track: #57534e;
  }
}
</style>
