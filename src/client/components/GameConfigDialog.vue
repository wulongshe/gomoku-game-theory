<script setup lang="ts">
import { computed } from 'vue'
import AppDialog from '~/components/AppDialog.vue'
import DialogButton from '~/components/DialogButton.vue'
import RangeSlider from '~/components/RangeSlider.vue'
import SegmentedControl from '~/components/SegmentedControl.vue'
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

// 展示为「难度值」：难度 + slip（放水概率）= 1，故越往右放水越少、AI 越强。
const difficultyLevel = computed({
  get: () => Math.round((1 - slip.value) * 20) / 20,
  set: (level) => (slip.value = Math.round((1 - level) * 20) / 20),
})
// 低难度偏绿、高难度偏红。
const fillColor = computed(() => `hsl(${(1 - difficultyLevel.value) * 130}deg 68% 45%)`)

const frameLabel = (option: number) => (option ? `${option}s` : '不限')
const modeLabel = (option: GameMode) => MODE_LABELS[option]
const difficultyLabel = (option: Difficulty) => DIFFICULTY_LABELS[option]
</script>

<template>
  <AppDialog :title="title" @close="emit('cancel')">
    <div class="flex flex-col gap-3 text-sm">
      <div v-if="showFrame" class="flex flex-col gap-2">
        <span class="text-center text-stone-500 dark:text-stone-400">每回合</span>
        <SegmentedControl
          v-model="frame"
          v-model:values="frames"
          :options="FRAME_OPTIONS"
          :label="frameLabel"
          :multi="multi"
          :disabled="disabled"
        />
      </div>
      <div class="flex flex-col gap-2">
        <span class="text-center text-stone-500 dark:text-stone-400">撞子后</span>
        <SegmentedControl
          v-model="mode"
          v-model:values="modes"
          :options="modeOptions"
          :label="modeLabel"
          :multi="multi"
          :disabled="disabled"
        />
      </div>
      <div v-if="difficulties" class="flex flex-col gap-2">
        <span class="text-center text-stone-500 dark:text-stone-400">难度</span>
        <SegmentedControl v-model="difficulty" :options="difficulties" :label="difficultyLabel" />
      </div>
      <div v-if="difficulties && difficulty === 'hell'" class="flex flex-col gap-2">
        <span class="text-center text-stone-500 dark:text-stone-400">难度值 {{ Math.round(difficultyLevel * 100) }}%</span>
        <RangeSlider v-model="difficultyLevel" :min="0.05" :max="0.95" :step="0.05" :fill="fillColor" />
      </div>
    </div>
    <template #footer>
      <div class="flex flex-col gap-4">
        <p v-if="hint" class="text-center text-xs text-stone-400 dark:text-stone-500">{{ hint }}</p>
        <div class="flex">
          <DialogButton @click="emit('confirm')">
            <IconSpinner v-if="loading" class="size-4" />
            {{ confirmText }}
          </DialogButton>
        </div>
      </div>
    </template>
  </AppDialog>
</template>
