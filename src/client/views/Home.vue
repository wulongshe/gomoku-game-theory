<script setup lang="ts">
import { computed, ref } from 'vue'
import { useStorage, useTimestamp, useWebSocket } from '@vueuse/core'
import AppButton from '~/components/AppButton.vue'
import RulesDialog from '~/components/RulesDialog.vue'
import IconCheck from '~/components/icons/IconCheck.vue'
import IconGithub from '~/components/icons/IconGithub.vue'
import IconHelp from '~/components/icons/IconHelp.vue'
import IconXiaohongshu from '~/components/icons/IconXiaohongshu.vue'
import IconSpinner from '~/components/icons/IconSpinner.vue'
import IconStones from '~/components/icons/IconStones.vue'
import { createRoom, matchWsUrl } from '~/apis'
import { MODE_LABELS, RULES, SUBTITLE, TAGLINE, TITLE } from '~/constants/branding'
import {
  FRAME_OPTIONS,
  MODE_OPTIONS,
  ROOM_CODE_LENGTH,
  ROOM_CODE_PATTERN,
  type LobbyServerMessage,
} from '@/shared/protocol'
import type { GameMode } from '@/engine/game'

const creating = ref(false)
const matching = ref(false)
const showRules = ref(false)
const showCreateHint = ref(false)
let matched = false

const frameChoices = useStorage<number[]>('frame-choices', [...FRAME_OPTIONS])
const modeChoices = useStorage<GameMode[]>('mode-choices', [...MODE_OPTIONS])
modeChoices.value = modeChoices.value.filter((m) => MODE_OPTIONS.includes(m))
if (!modeChoices.value.length) modeChoices.value = [...MODE_OPTIONS]

function toggled<T>(current: T[], options: T[], option: T): T[] {
  const next = current.includes(option)
    ? current.filter((o) => o !== option)
    : options.filter((o) => current.includes(o) || o === option)
  return next.length ? next : current
}


const joinCode = ref('')
const joinCodeValid = computed(() => ROOM_CODE_PATTERN.test(joinCode.value))

function join() {
  if (joinCodeValid.value) location.assign(`/room/${joinCode.value}`)
}

const now = useTimestamp({ interval: 1000 })
const matchStart = ref(0)
const matchSeconds = computed(() => Math.max(0, Math.floor((now.value - matchStart.value) / 1000)))

async function create() {
  if (frameChoices.value.length > 1 || modeChoices.value.length > 1) {
    showCreateHint.value = true
    return
  }
  creating.value = true
  try {
    location.assign(`/room/${await createRoom(frameChoices.value[0], modeChoices.value[0])}`)
  } catch {
    creating.value = false
  }
}

const { open: openMatch, close: closeMatch } = useWebSocket(
  computed(() => matchWsUrl(frameChoices.value, modeChoices.value)),
  {
    immediate: false,
    autoConnect: false,
    onMessage(_, event) {
      const msg = JSON.parse(event.data) as LobbyServerMessage
      if (msg.type === 'matched') {
        matched = true
        location.assign(`/room/${msg.code}`)
      }
    },
    onDisconnected() {
      if (!matched) matching.value = false
    },
  },
)

function toggleMatch() {
  if (matching.value) {
    closeMatch()
    matching.value = false
  } else {
    matching.value = true
    matchStart.value = Date.now()
    openMatch()
  }
}

</script>

<template>
  <main
    class="relative flex min-h-dvh flex-col items-center justify-center gap-8 bg-gradient-to-b from-stone-100 to-stone-200 p-6 dark:from-stone-900 dark:to-stone-950"
  >
    <div class="absolute left-5 top-5 flex items-center gap-1">
      <a
        href="https://www.xiaohongshu.com/user/profile/610795550000000001005301"
        target="_blank"
        rel="noopener"
        aria-label="小红书"
        class="p-2 transition-opacity hover:opacity-80 active:opacity-80"
      >
        <IconXiaohongshu class="h-5 w-auto" />
      </a>
      <a
        href="https://github.com/wulongshe/gomoku-game-theory"
        target="_blank"
        rel="noopener"
        aria-label="GitHub"
        class="p-2 transition-opacity hover:opacity-80 active:opacity-80"
      >
        <IconGithub class="size-5" />
      </a>
    </div>

    <button
      class="absolute right-5 top-5 flex cursor-pointer items-center gap-1.5 rounded-full p-2 text-sm leading-none text-stone-400 transition-colors hover:text-stone-600 active:text-stone-600 dark:text-stone-500 dark:hover:text-stone-300 dark:active:text-stone-300"
      @click="showRules = true"
    >
      <IconHelp class="size-5 translate-y-[1.5px]" />
      <span>游戏规则</span>
    </button>

    <div class="flex flex-col items-center gap-3">
      <IconStones class="h-8 drop-shadow" />
      <h1 class="text-3xl font-bold tracking-wide text-stone-800 dark:text-stone-100">{{ TITLE }}</h1>
      <p class="font-medium text-stone-600 dark:text-stone-300">{{ TAGLINE }}</p>
      <p class="text-sm text-stone-500 dark:text-stone-400">{{ SUBTITLE }}</p>
    </div>

    <div class="flex w-full max-w-md flex-col gap-2">
      <div
        v-for="rule in RULES"
        :key="rule.title"
        class="flex items-center gap-4 rounded-xl bg-white/80 px-5 py-3.5 shadow-sm backdrop-blur dark:bg-stone-800/80"
      >
        <span
          class="flex size-9 shrink-0 items-center justify-center rounded-full bg-wood/30 text-base leading-none"
        ><span class="block -translate-y-px">{{ rule.icon }}</span></span>
        <div>
          <p class="text-sm font-semibold text-stone-800 dark:text-stone-100">{{ rule.title }}</p>
          <p class="text-xs text-stone-500 dark:text-stone-400">{{ rule.text }}</p>
        </div>
      </div>
    </div>

    <div class="flex w-full max-w-md flex-col items-center gap-2">
      <div class="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 pb-1 text-sm">
        <div class="flex flex-col items-center gap-1.5">
          <span class="text-stone-500 dark:text-stone-400">每回合</span>
          <div class="flex gap-1.5">
            <button
              v-for="option in FRAME_OPTIONS"
              :key="option"
              class="inline-flex h-7 min-w-16 cursor-pointer items-center justify-center gap-1.5 rounded-md px-2 pb-px font-medium leading-none transition-colors"
              :class="frameChoices.includes(option) ? 'bg-white text-stone-800 shadow-sm dark:bg-stone-700 dark:text-stone-100' : 'bg-stone-300/60 text-stone-500 dark:bg-stone-800/60 dark:text-stone-400'"
              :disabled="matching"
              @click="frameChoices = toggled(frameChoices, FRAME_OPTIONS, option)"
            >
              <span
                class="flex size-3.5 items-center justify-center rounded-sm border transition-colors"
                :class="frameChoices.includes(option) ? 'border-emerald-600 bg-emerald-600' : 'border-stone-400 dark:border-stone-500'"
              >
                <IconCheck v-if="frameChoices.includes(option)" class="size-2.5 text-white" />
              </span>
              {{ option ? `${option}s` : '不限' }}
            </button>
          </div>
        </div>
        <div class="flex flex-col items-center gap-1.5">
          <span class="text-stone-500 dark:text-stone-400">撞点后</span>
          <div class="flex gap-1.5">
            <button
              v-for="option in MODE_OPTIONS"
              :key="option"
              class="inline-flex h-7 w-16 cursor-pointer items-center justify-center gap-1.5 rounded-md pb-px font-medium leading-none transition-colors"
              :class="modeChoices.includes(option) ? 'bg-white text-stone-800 shadow-sm dark:bg-stone-700 dark:text-stone-100' : 'bg-stone-300/60 text-stone-500 dark:bg-stone-800/60 dark:text-stone-400'"
              :disabled="matching"
              @click="modeChoices = toggled(modeChoices, MODE_OPTIONS, option)"
            >
              <span
                class="flex size-3.5 items-center justify-center rounded-sm border transition-colors"
                :class="modeChoices.includes(option) ? 'border-emerald-600 bg-emerald-600' : 'border-stone-400 dark:border-stone-500'"
              >
                <IconCheck v-if="modeChoices.includes(option)" class="size-2.5 text-white" />
              </span>
              {{ MODE_LABELS[option] }}
            </button>
          </div>
        </div>
      </div>
      <AppButton secondary class="w-full" :disabled="creating" @click="toggleMatch">
        <span class="flex items-center justify-center gap-2">
          <IconSpinner v-if="matching" class="size-5" />
          <span>{{ matching ? `匹配中…${matchSeconds}s，点击取消` : '随机匹配' }}</span>
        </span>
      </AppButton>
      <AppButton class="w-full" :disabled="creating || matching" @click="create">
        <span class="flex items-center justify-center gap-2">
          <IconSpinner v-if="creating" class="size-5" />
          <span>{{ creating ? '创建中…' : '创建房间' }}</span>
        </span>
      </AppButton>
      <div class="flex w-full gap-2">
        <input
          v-model="joinCode"
          :maxlength="ROOM_CODE_LENGTH"
          placeholder="输入房间号"
          class="min-w-0 flex-1 rounded-xl border border-stone-300 bg-white/80 px-4 py-3 text-lg text-stone-800 shadow-sm placeholder:text-stone-400 focus:border-stone-500 focus:outline-none dark:border-stone-600 dark:bg-stone-800/80 dark:text-stone-100 dark:placeholder:text-stone-500 dark:focus:border-stone-400"
          @input="joinCode = joinCode.toUpperCase()"
          @keyup.enter="join"
        />
        <AppButton :disabled="!joinCodeValid || creating || matching" @click="join">进入</AppButton>
      </div>
      <p class="text-xs text-stone-400 dark:text-stone-500">免下载 · 免注册，10 秒开局</p>
    </div>

    <RulesDialog v-if="showRules" @close="showRules = false" />

    <div
      v-if="showCreateHint"
      class="fixed inset-0 z-10 flex items-center justify-center bg-black/40 p-6"
      @click.self="showCreateHint = false"
    >
      <div class="flex w-full max-w-xs flex-col gap-4 rounded-2xl bg-white p-6 shadow-lg dark:bg-stone-800">
        <p class="text-lg font-semibold text-stone-800 dark:text-stone-100">无法创建房间</p>
        <p class="text-sm text-stone-500 dark:text-stone-400">
          创建房间需要确定的设置，请在「每回合」和「撞点后」中各保留一个选项。
        </p>
        <AppButton class="w-full" @click="showCreateHint = false">知道了</AppButton>
      </div>
    </div>
  </main>
</template>
