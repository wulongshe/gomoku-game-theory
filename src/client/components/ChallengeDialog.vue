<script setup lang="ts">
import { onMounted, ref } from 'vue'
import AppDialog from '~/components/AppDialog.vue'
import DialogButton from '~/components/DialogButton.vue'
import SegmentedControl from '~/components/SegmentedControl.vue'
import IconCheck from '~/components/icons/IconCheck.vue'
import IconLock from '~/components/icons/IconLock.vue'
import IconSpinner from '~/components/icons/IconSpinner.vue'
import { fetchChallenge } from '~/apis'
import { CHALLENGE_ID } from '~/challenges'
import { useAuth } from '~/composables/useAuth'
import { useChallengeProgress } from '~/composables/useChallengeProgress'
import { CHALLENGE_TITLE, challengeRules, DIFFICULTY_LABELS } from '@gomoku/branding'
import { DIFFICULTY_OPTIONS } from '@gomoku/config'
import type { Difficulty } from '@gomoku/engine/ai'
import type { ChallengeClear } from '@/shared/protocol'

const emit = defineEmits<{ close: []; login: [] }>()

const RULES = challengeRules()
const MEDALS = ['🥇', '🥈', '🥉']
const { loggedIn } = useAuth()
const progress = useChallengeProgress(CHALLENGE_ID)
const difficulty = ref<Difficulty>(progress.highestUnlocked.value)
const clears = ref<ChallengeClear[]>([])
const loading = ref(true)

onMounted(async () => {
  try {
    const info = await fetchChallenge(CHALLENGE_ID)
    clears.value = info.clears
    progress.merge(info.mine)
    difficulty.value = progress.highestUnlocked.value
  } catch {
    // 榜单加载失败不影响挑战
  } finally {
    loading.value = false
  }
})

const label = (option: Difficulty) => DIFFICULTY_LABELS[option]
const locked = (option: Difficulty) => !progress.unlocked(option)
const cleared = (option: Difficulty) => progress.cleared.value.includes(option)

function start() {
  location.assign(`/challenge?difficulty=${difficulty.value}`)
}
</script>

<template>
  <AppDialog :title="CHALLENGE_TITLE" @close="emit('close')">
    <div class="-mx-3 -mb-2 flex flex-col gap-4">
      <div class="rounded-xl bg-stone-100 px-4 py-3 dark:bg-stone-700/50">
        <ul class="flex flex-col gap-1 text-xs text-stone-500 dark:text-stone-400">
          <li v-for="item in RULES" :key="item" class="flex gap-1.5">
            <span class="text-stone-300 dark:text-stone-600">•</span>
            <span>{{ item }}</span>
          </li>
        </ul>
      </div>

      <div class="flex flex-col gap-2 text-sm">
        <span class="text-center text-stone-500 dark:text-stone-400">难度</span>
        <SegmentedControl
          v-model="difficulty"
          :options="DIFFICULTY_OPTIONS"
          :label="label"
          :option-disabled="locked"
        >
          <template #option="{ option }">
            <IconCheck v-if="cleared(option)" class="size-3 text-emerald-600 dark:text-emerald-400" />
            <IconLock v-else-if="locked(option)" class="size-3" />
            {{ label(option) }}
          </template>
        </SegmentedControl>
      </div>

      <div class="flex flex-col gap-1.5">
        <div v-if="loading" class="flex justify-center py-4">
          <IconSpinner class="size-5 text-stone-400" />
        </div>
        <p v-else-if="!clears.length" class="py-3 text-center text-sm text-stone-500 dark:text-stone-400">
          还没有人成功，来当第一个
        </p>
        <div v-else class="flex max-h-48 flex-col gap-1 overflow-y-auto overscroll-contain">
          <div
            v-for="(entry, i) in clears"
            :key="i"
            class="flex items-center gap-3 rounded-xl bg-stone-100 px-4 py-2.5 text-sm dark:bg-stone-700/50"
          >
            <span class="min-w-5 shrink-0 text-center">
              <template v-if="i < MEDALS.length">{{ MEDALS[i] }}</template>
              <span v-else class="font-semibold text-stone-400 dark:text-stone-500">{{ i + 1 }}</span>
            </span>
            <span
              class="min-w-0 flex-1 overflow-x-auto whitespace-nowrap text-stone-700 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden dark:text-stone-200"
            >{{ entry.email }}</span>
            <span class="shrink-0 font-semibold text-amber-600 dark:text-amber-400">
              {{ DIFFICULTY_LABELS[entry.difficulty] }}
            </span>
          </div>
        </div>
      </div>

      <p v-if="!loggedIn" class="text-center text-xs text-amber-600 dark:text-amber-400">
        <button class="cursor-pointer underline" @click="emit('login')">登录</button>后成功记录会展示在这里
      </p>
    </div>

    <template #footer>
      <div class="-mx-3 flex flex-col">
        <DialogButton @click="start">开始挑战</DialogButton>
      </div>
    </template>
  </AppDialog>
</template>
