<script setup lang="ts">
import { ref } from 'vue'
import Taro, { useShareAppMessage } from '@tarojs/taro'
import Game from '@/components/Game.vue'
import Home from '@/components/Home.vue'
import { loadConfig, type GameConfig } from '@/game/config'
import { DIFFICULTY_LABELS, TAGLINE, TITLE } from '@gomoku/branding'
import { AI_MODE_OPTIONS, DIFFICULTY_OPTIONS } from '@gomoku/config'
import type { Difficulty } from '@gomoku/engine/ai'
import type { GameMode } from '@gomoku/engine/game'

// 小组件只允许一个页面：首页与对战在同一页内按状态切换。
const config = ref<GameConfig>(loadConfig())
const playing = ref(false)

// 分享直达：带 mode/difficulty 参数打开时直接进入同配置对局。
const params = Taro.getCurrentInstance().router?.params ?? {}
const sharedMode = params.mode as GameMode
const sharedDifficulty = params.difficulty as Difficulty
if (AI_MODE_OPTIONS.includes(sharedMode) && DIFFICULTY_OPTIONS.includes(sharedDifficulty)) {
  config.value = { mode: sharedMode, difficulty: sharedDifficulty }
  playing.value = true
}

useShareAppMessage(() =>
  playing.value
    ? {
        title: `敢来挑战${DIFFICULTY_LABELS[config.value.difficulty]} AI 吗？｜${TITLE}`,
        path: `/pages/index/index?mode=${config.value.mode}&difficulty=${config.value.difficulty}`,
      }
    : { title: `${TITLE}｜${TAGLINE}`, path: '/pages/index/index' },
)

function start(next: GameConfig): void {
  config.value = next
  playing.value = true
}
</script>

<template>
  <Game v-if="playing" :config="config" @configure="config = $event" @exit="playing = false" />
  <Home v-else @start="start" />
</template>
