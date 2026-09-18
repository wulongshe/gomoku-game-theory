<script setup lang="ts">
import { ref } from 'vue'
import Taro, { useShareAppMessage } from '@tarojs/taro'
import Game from '@/components/Game.vue'
import Home from '@/components/Home.vue'
import { loadDifficulty } from '@/game/config'
import { DIFFICULTY_LABELS, TAGLINE, TITLE } from '@gomoku/branding'
import { DIFFICULTY_OPTIONS } from '@gomoku/config'
import type { Difficulty } from '@gomoku/engine/ai'

// 小组件只允许一个页面：首页与对战在同一页内按状态切换。
const difficulty = ref<Difficulty>(loadDifficulty())
const playing = ref(false)

// 分享直达：带 difficulty 参数打开时直接进入同配置对局。
const params = Taro.getCurrentInstance().router?.params ?? {}
const sharedDifficulty = params.difficulty as Difficulty
if (DIFFICULTY_OPTIONS.includes(sharedDifficulty)) {
  difficulty.value = sharedDifficulty
  playing.value = true
}

useShareAppMessage(() =>
  playing.value
    ? {
        title: `敢来挑战${DIFFICULTY_LABELS[difficulty.value]} AI 吗？｜${TITLE}`,
        path: `/pages/index/index?difficulty=${difficulty.value}`,
      }
    : { title: `${TITLE}｜${TAGLINE}`, path: '/pages/index/index' },
)

function start(next: Difficulty): void {
  difficulty.value = next
  playing.value = true
}
</script>

<template>
  <Game v-if="playing" :difficulty="difficulty" @configure="difficulty = $event" @exit="playing = false" />
  <Home v-else @start="start" />
</template>
