<script setup lang="ts">
import { computed } from 'vue'
import AppDialog from '~/components/AppDialog.vue'
import DialogButton from '~/components/DialogButton.vue'
import RangeSlider from '~/components/RangeSlider.vue'
import SegmentedControl from '~/components/SegmentedControl.vue'
import IconSpinner from '~/components/icons/IconSpinner.vue'
import { DIFFICULTY_LABELS, MODE_LABELS } from '@gomoku/branding'
import { DEFAULT_EXPERT_LEVEL, EXPERT_LEVEL_MAX, EXPERT_LEVEL_MIN } from '@gomoku/config'
import { FRAME_OPTIONS, MODE_OPTIONS } from '@/shared/protocol'
import type { GameMode } from '@gomoku/engine/game'
import type { Difficulty } from '@gomoku/engine/ai'

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
// level：专家难度等级 1~20（越往右 AI 越强）；引擎读心置信度 = (level - 1) / 20，在 AiRoom 换算。
const level = defineModel<number>('level', { default: DEFAULT_EXPERT_LEVEL })

// 低等级偏绿、高等级偏红。
const fillColor = computed(
  () => `hsl(${(1 - (level.value - EXPERT_LEVEL_MIN) / (EXPERT_LEVEL_MAX - EXPERT_LEVEL_MIN)) * 130}deg 68% 45%)`,
)

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
      <div v-if="difficulties && difficulty === 'expert'" class="flex flex-col gap-2">
        <span class="text-center text-stone-500 dark:text-stone-400">{{ level }} 级</span>
        <RangeSlider
          v-model="level"
          :min="EXPERT_LEVEL_MIN"
          :max="EXPERT_LEVEL_MAX"
          :step="1"
          :fill="fillColor"
        />
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
