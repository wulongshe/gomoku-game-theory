<script setup lang="ts">
import AppDialog from '~/components/AppDialog.vue'
import DialogButton from '~/components/DialogButton.vue'
import { frameLabel } from '~/utils/format'

defineProps<{
  frameSeconds: number | null
  secondsLeft: number | null
}>()
const emit = defineEmits<{ accept: []; decline: [] }>()
</script>

<template>
  <AppDialog title="对方想再来一局" :closable="false">
    <p v-if="frameSeconds !== null" class="text-sm text-stone-600 dark:text-stone-300">
      <span class="rounded-full bg-stone-100 px-2.5 py-1 dark:bg-stone-700/60">每回合 {{ frameLabel(frameSeconds) }}</span>
    </p>
    <p class="text-sm text-stone-500 dark:text-stone-400">{{ secondsLeft }} 秒后自动关闭</p>
    <template #footer>
      <div class="flex gap-2">
        <DialogButton variant="secondary" @click="emit('decline')">拒绝</DialogButton>
        <DialogButton @click="emit('accept')">接受</DialogButton>
      </div>
    </template>
  </AppDialog>
</template>
