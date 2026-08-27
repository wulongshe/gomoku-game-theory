<script setup lang="ts">
import AppDialog from '~/components/AppDialog.vue'
import DialogButton from '~/components/DialogButton.vue'
import { frameLabel, MODE_LABELS } from '~/constants/branding'
import type { GameMode } from '@/engine/game'

defineProps<{
  proposal: { frameSeconds: number; mode: GameMode } | null
  secondsLeft: number | null
}>()
const emit = defineEmits<{ accept: []; decline: [] }>()
</script>

<template>
  <AppDialog title="对方想再来一局" @close="emit('decline')">
    <p v-if="proposal" class="flex items-center gap-2 text-sm text-stone-600 dark:text-stone-300">
      <span class="rounded-full bg-stone-100 px-2.5 py-1 dark:bg-stone-700/60">每回合 {{ frameLabel(proposal.frameSeconds) }}</span>
      <span class="rounded-full bg-stone-100 px-2.5 py-1 dark:bg-stone-700/60">{{ MODE_LABELS[proposal.mode] }}模式</span>
    </p>
    <p class="text-sm text-stone-500 dark:text-stone-400">{{ secondsLeft }} 秒后自动关闭</p>
    <div class="flex">
      <DialogButton @click="emit('accept')">接受</DialogButton>
    </div>
  </AppDialog>
</template>
