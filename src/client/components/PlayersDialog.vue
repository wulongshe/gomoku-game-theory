<script setup lang="ts">
import { computed } from 'vue'
import AppDialog from '~/components/AppDialog.vue'
import AppSwitch from '~/components/AppSwitch.vue'
import IconStone from '~/components/icons/IconStone.vue'
import { useAuth } from '~/composables/useAuth'
import type { Seat } from '@gomoku/engine/game'

const props = defineProps<{
  accounts: Record<Seat, string | null>
  seat: Seat
}>()
const emit = defineEmits<{ close: []; visibility: [visible: boolean] }>()

const { loggedIn, emailVisibility, setEmailVisible } = useAuth()

const visible = computed({
  get: () => emailVisibility.value.game,
  set: async (value: boolean) => {
    await setEmailVisible('game', value)
    emit('visibility', value)
  },
})

const players = computed(() =>
  (['black', 'white'] as const).flatMap((seat) => {
    const email = props.accounts[seat]
    if (!email) return []
    const side = seat === 'black' ? '执黑' : '执白'
    return [{ seat, email, label: seat === props.seat ? `你${side}` : `对方${side}` }]
  }),
)
</script>

<template>
  <AppDialog title="玩家信息" @close="emit('close')">
    <div class="flex flex-col gap-2">
      <div
        v-for="player in players"
        :key="player.seat"
        class="flex flex-col gap-1 rounded-xl bg-stone-100 px-4 py-3 dark:bg-stone-700/50"
      >
        <span class="flex items-center gap-2 text-sm font-medium text-stone-700 dark:text-stone-200">
          <IconStone :seat="player.seat" class="size-3.5" />
          {{ player.label }}
        </span>
        <span class="break-all text-xs text-stone-500 dark:text-stone-400">{{ player.email }}</span>
      </div>
    </div>
    <AppSwitch v-if="loggedIn" v-model="visible">允许对方查看我的完整邮箱</AppSwitch>
  </AppDialog>
</template>
