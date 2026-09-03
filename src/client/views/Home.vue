<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useEventListener, useStorage, useTimestamp, useWebSocket } from '@vueuse/core'
import AppButton from '~/components/AppButton.vue'
import AuthDialog from '~/components/AuthDialog.vue'
import GameConfigDialog from '~/components/GameConfigDialog.vue'
import LeaderboardDialog from '~/components/LeaderboardDialog.vue'
import TournamentDialog from '~/components/TournamentDialog.vue'
import RulesDialog from '~/components/RulesDialog.vue'
import IconBilibili from '~/components/icons/IconBilibili.vue'
import IconChevronRight from '~/components/icons/IconChevronRight.vue'
import IconGithub from '~/components/icons/IconGithub.vue'
import IconHelp from '~/components/icons/IconHelp.vue'
import IconShare from '~/components/icons/IconShare.vue'
import IconUser from '~/components/icons/IconUser.vue'
import IconXiaohongshu from '~/components/icons/IconXiaohongshu.vue'
import IconStones from '~/components/icons/IconStones.vue'
import SharePoster from '~/components/SharePoster.vue'
import { createRoom, matchWsUrl } from '~/apis'
import { useAuth } from '~/composables/useAuth'
import { rules, SUBTITLE, TAGLINE, TITLE } from '@gomoku/branding'
import { AI_MODE_OPTIONS, DIFFICULTY_OPTIONS } from '@gomoku/config'
import {
  FRAME_OPTIONS,
  MODE_OPTIONS,
  ROOM_CODE_MAX_LENGTH,
  ROOM_CODE_PATTERN,
  type LobbyServerMessage,
} from '@/shared/protocol'
import type { GameMode } from '@gomoku/engine/game'
import { type Difficulty } from '@gomoku/engine/ai'

const RULES = rules()
const creating = ref(false)
const matching = ref(false)
const showRules = ref(false)
const showInvite = ref(false)
const showMatch = ref(false)
const showAuth = ref(false)
const showLeaderboard = ref(false)
const showTournament = ref(false)
const showAi = ref(false)

function loginFromTournament() {
  showTournament.value = false
  showAuth.value = true
}

const { email: authEmail, loggedIn, refresh } = useAuth()
refresh()
const authLabel = computed(() => (loggedIn.value ? authEmail.value.split('@')[0] : '登录/注册'))
let matched = false

const frameChoices = useStorage<number[]>('frame-choices', [...FRAME_OPTIONS])
const modeChoices = useStorage<GameMode[]>('mode-choices', [...MODE_OPTIONS])
modeChoices.value = modeChoices.value.filter((m) => MODE_OPTIONS.includes(m))
if (!modeChoices.value.length) modeChoices.value = [...MODE_OPTIONS]

const sitePoster = ref<InstanceType<typeof SharePoster> | null>(null)
const siteUrl = `${location.origin}/`

const joinCode = ref('')
const joinCodeValid = computed(() => ROOM_CODE_PATTERN.test(joinCode.value))

function join() {
  if (joinCodeValid.value) location.assign(`/room/${joinCode.value}`)
}

const now = useTimestamp({ interval: 1000 })
const matchStart = ref(0)
const matchSeconds = computed(() => Math.max(0, Math.floor((now.value - matchStart.value) / 1000)))

const inviteFrame = useStorage('invite-frame', FRAME_OPTIONS[0])
const inviteMode = useStorage<GameMode>('invite-mode', MODE_OPTIONS[0])
if (!FRAME_OPTIONS.includes(inviteFrame.value)) inviteFrame.value = FRAME_OPTIONS[0]
if (!MODE_OPTIONS.includes(inviteMode.value)) inviteMode.value = MODE_OPTIONS[0]

const aiMode = useStorage<GameMode>('ai-mode', 'forbidden')
const aiDifficulty = useStorage<Difficulty>('ai-difficulty', 'normal')
if (!AI_MODE_OPTIONS.includes(aiMode.value)) aiMode.value = 'forbidden'
if (!DIFFICULTY_OPTIONS.includes(aiDifficulty.value)) aiDifficulty.value = 'normal'

// 人机对战恒不限时。
function startAi() {
  location.assign(`/ai?mode=${aiMode.value}&difficulty=${aiDifficulty.value}`)
}

async function create() {
  if (creating.value) return
  creating.value = true
  try {
    location.assign(`/room/${await createRoom(inviteFrame.value, inviteMode.value)}`)
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

function closeMatchDialog() {
  if (matching.value) {
    closeMatch()
    matching.value = false
  }
  showMatch.value = false
}

// 小屏内容超出一屏时提示可下滑，滚到接近底部即淡出。
const scrollHint = ref(false)
function updateScrollHint() {
  const doc = document.documentElement
  scrollHint.value = doc.scrollHeight - window.innerHeight - window.scrollY > 48
}
onMounted(updateScrollHint)
useEventListener(window, 'scroll', updateScrollHint, { passive: true })
useEventListener(window, 'resize', updateScrollHint)

</script>

<template>
  <main
    class="relative flex min-h-dvh flex-col items-center justify-center gap-8 bg-gradient-to-b from-stone-100 to-stone-200 p-6 dark:from-stone-900 dark:to-stone-950"
  >
    <div class="absolute inset-x-6 top-5 mx-auto flex max-w-md items-center justify-between">
      <button
        class="-mx-2 flex cursor-pointer items-center gap-1.5 rounded-full p-2 text-sm leading-none text-stone-400 transition-colors hover:text-stone-600 active:text-stone-600 dark:text-stone-500 dark:hover:text-stone-300 dark:active:text-stone-300"
        @click="showAuth = true"
      >
        <IconUser class="size-5" />
        <span>{{ authLabel }}</span>
      </button>

      <button
        class="-mx-2 flex cursor-pointer items-center gap-1.5 rounded-full p-2 text-sm leading-none text-stone-400 transition-colors hover:text-stone-600 active:text-stone-600 dark:text-stone-500 dark:hover:text-stone-300 dark:active:text-stone-300"
        @click="showRules = true"
      >
        <IconHelp class="size-5" />
        <span>游戏规则</span>
      </button>
    </div>

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
      <button
        class="flex cursor-pointer items-center gap-4 rounded-xl bg-white/80 px-5 py-3.5 text-left shadow-sm backdrop-blur transition-colors hover:bg-white dark:bg-stone-800/80 dark:hover:bg-stone-800"
        @click="showLeaderboard = true"
      >
        <span
          class="flex size-9 shrink-0 items-center justify-center rounded-full bg-wood/30 text-base leading-none"
        ><span class="block -translate-y-px">🏆</span></span>
        <div class="flex-1">
          <p class="text-sm font-semibold text-stone-800 dark:text-stone-100">排行榜</p>
          <p class="text-xs text-stone-500 dark:text-stone-400">注册玩家的对局战绩</p>
        </div>
        <IconChevronRight class="size-4 text-stone-400 dark:text-stone-500" />
      </button>
      <button
        class="flex cursor-pointer items-center gap-4 rounded-xl bg-white/80 px-5 py-3.5 text-left shadow-sm backdrop-blur transition-colors hover:bg-white dark:bg-stone-800/80 dark:hover:bg-stone-800"
        @click="showTournament = true"
      >
        <span
          class="flex size-9 shrink-0 items-center justify-center rounded-full bg-wood/30 text-base leading-none"
        ><span class="block -translate-y-px">🏅</span></span>
        <div class="flex-1">
          <p class="text-sm font-semibold text-stone-800 dark:text-stone-100">每日大赛</p>
          <p class="text-xs text-stone-500 dark:text-stone-400">每天 20:00 · 瑞士轮积分</p>
        </div>
        <IconChevronRight class="size-4 text-stone-400 dark:text-stone-500" />
      </button>
    </div>

    <div class="flex w-full max-w-md flex-col items-center gap-2">
      <div class="flex w-full gap-2">
        <AppButton secondary class="flex-1" @click="showMatch = true">随机匹配</AppButton>
        <AppButton secondary class="flex-1" @click="showAi = true">人机对战</AppButton>
      </div>
      <div class="flex w-full gap-2">
        <AppButton class="shrink-0" @click="showInvite = true">邀请好友</AppButton>
        <div
          class="flex min-w-0 flex-1 overflow-hidden rounded-xl border border-stone-300 bg-white/80 shadow-sm focus-within:border-stone-500 dark:border-stone-600 dark:bg-stone-800/80 dark:focus-within:border-stone-400"
        >
          <input
            v-model="joinCode"
            :maxlength="ROOM_CODE_MAX_LENGTH"
            inputmode="numeric"
            placeholder="输入房间号"
            class="min-w-0 flex-1 bg-transparent px-4 py-3 text-lg text-stone-800 placeholder:text-stone-400 focus:outline-none dark:text-stone-100 dark:placeholder:text-stone-500"
            @input="joinCode = joinCode.replace(/\D/g, '')"
            @keyup.enter="join"
          />
          <button
            class="cursor-pointer bg-stone-800 px-5 text-lg font-medium text-white active:bg-stone-600 disabled:opacity-50 dark:bg-stone-200 dark:text-stone-900 dark:active:bg-stone-400"
            :disabled="!joinCodeValid"
            @click="join"
          >
            进入
          </button>
        </div>
      </div>
      <div class="flex items-center gap-1">
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
          href="https://space.bilibili.com/358762350?spm_id_from=333.1007.0.0"
          target="_blank"
          rel="noopener"
          aria-label="哔哩哔哩"
          class="p-2 transition-opacity hover:opacity-80 active:opacity-80"
        >
          <IconBilibili class="size-5" />
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
        <button
          type="button"
          aria-label="分享海报"
          class="cursor-pointer p-2 text-stone-500 transition-opacity hover:opacity-80 active:opacity-80 dark:text-stone-400"
          @click="sitePoster?.share()"
        >
          <IconShare class="size-5" />
        </button>
      </div>
      <p class="text-xs text-stone-400 dark:text-stone-500">免下载 · 免注册，10 秒开局</p>
    </div>

    <div
      class="pointer-events-none fixed inset-x-0 bottom-0 z-10 flex flex-col items-center gap-0.5 bg-gradient-to-t from-stone-200 via-stone-200/70 to-transparent pb-1.5 pt-10 text-stone-500 transition-opacity duration-300 dark:from-stone-950 dark:via-stone-950/70 dark:text-stone-400"
      :class="scrollHint ? 'opacity-100' : 'opacity-0'"
    >
      <span class="text-xs">下滑查看更多</span>
      <span class="animate-bounce"><IconChevronRight class="size-4 rotate-90" /></span>
    </div>

    <div class="hidden"><SharePoster ref="sitePoster" :url="siteUrl" /></div>

    <RulesDialog v-if="showRules" @close="showRules = false" />

    <AuthDialog v-if="showAuth" @close="showAuth = false" />

    <LeaderboardDialog v-if="showLeaderboard" @close="showLeaderboard = false" />

    <TournamentDialog
      v-if="showTournament"
      @close="showTournament = false"
      @login="loginFromTournament"
    />

    <GameConfigDialog
      v-if="showAi"
      v-model:mode="aiMode"
      v-model:difficulty="aiDifficulty"
      :show-frame="false"
      :mode-options="AI_MODE_OPTIONS"
      :difficulties="DIFFICULTY_OPTIONS"
      title="人机对战"
      confirm-text="开始对战"
      @cancel="showAi = false"
      @confirm="startAi"
    />

    <GameConfigDialog
      v-if="showInvite"
      v-model:frame="inviteFrame"
      v-model:mode="inviteMode"
      title="邀请好友"
      :confirm-text="creating ? '邀请中…' : '发起邀请'"
      :loading="creating"
      :disabled="creating"
      @cancel="showInvite = false"
      @confirm="create"
    />

    <GameConfigDialog
      v-if="showMatch"
      v-model:frames="frameChoices"
      v-model:modes="modeChoices"
      multi
      title="随机匹配"
      hint="按双方选项的交集撮合"
      :confirm-text="matching ? `匹配中…${matchSeconds}s，点击取消` : '开始匹配'"
      :loading="matching"
      :disabled="matching"
      @cancel="closeMatchDialog"
      @confirm="toggleMatch"
    />
  </main>
</template>
