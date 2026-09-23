<script setup lang="ts">
import AppDialog from '~/components/AppDialog.vue'
import DialogButton from '~/components/DialogButton.vue'
import SegmentedControl from '~/components/SegmentedControl.vue'
import IconSpinner from '~/components/icons/IconSpinner.vue'
import { DIFFICULTY_LABELS } from '@gomoku/branding'
import { FRAME_OPTIONS } from '@/shared/protocol'
import type { Difficulty } from '@gomoku/engine/ai'

withDefaults(
  defineProps<{
    title: string
    confirmText: string
    hint?: string
    loading?: boolean
    disabled?: boolean
    showFrame?: boolean
    difficulties?: Difficulty[]
  }>(),
  { showFrame: true },
)
const emit = defineEmits<{ cancel: []; confirm: [] }>()

const frame = defineModel<number>('frame', { default: FRAME_OPTIONS[0] })
const difficulty = defineModel<Difficulty>('difficulty', { default: 'normal' })

const frameLabel = (option: number) => (option ? `${option}s` : '不限')
const difficultyLabel = (option: Difficulty) => DIFFICULTY_LABELS[option]
</script>

<template>
  <AppDialog :title="title" @close="emit('cancel')">
    <div class="flex flex-col gap-3 text-sm">
      <div v-if="showFrame" class="flex flex-col gap-2">
        <span class="text-center text-stone-500 dark:text-stone-400">每回合</span>
        <SegmentedControl v-model="frame" :options="FRAME_OPTIONS" :label="frameLabel" :disabled="disabled" />
      </div>
      <div v-if="difficulties" class="flex flex-col gap-2">
        <span class="text-center text-stone-500 dark:text-stone-400">难度</span>
        <SegmentedControl v-model="difficulty" :options="difficulties" :label="difficultyLabel" />
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
