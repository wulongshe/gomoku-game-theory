<script setup lang="ts">
import { ref } from 'vue'
import Taro, { useShareAppMessage } from '@tarojs/taro'
import ConfigDialog, { type GameConfig } from '@/components/ConfigDialog.vue'
import RulesDialog from '@/components/RulesDialog.vue'
import { rules, SUBTITLE, TAGLINE, TITLE } from '@gomoku/branding'

useShareAppMessage(() => ({
  title: `${TITLE}｜${TAGLINE}`,
  path: '/pages/index/index',
}))

const RULES = rules('ai')
const showConfig = ref(false)
const showRules = ref(false)

function start(config: GameConfig): void {
  showConfig.value = false
  Taro.navigateTo({
    url: `/pages/game/index?mode=${config.mode}&level=${config.difficulty}&strength=${config.strength}`,
  })
}
</script>

<template>
  <view class="page">
    <text class="rules-entry" @tap="showRules = true">? 游戏规则</text>

    <view class="hero">
      <view class="stones">
        <view class="stone stone-black" />
        <view class="stone stone-white" />
      </view>
      <text class="title">{{ TITLE }}</text>
      <text class="tagline">{{ TAGLINE }}</text>
      <text class="subtitle">{{ SUBTITLE }}</text>
    </view>

    <view class="cards">
      <view v-for="rule in RULES" :key="rule.title" class="card">
        <view class="card-icon">{{ rule.icon }}</view>
        <view class="card-body">
          <text class="card-title">{{ rule.title }}</text>
          <text class="card-text">{{ rule.text }}</text>
        </view>
      </view>
    </view>

    <view class="btn btn-primary" @tap="showConfig = true">人机对战</view>

    <ConfigDialog v-if="showConfig" @cancel="showConfig = false" @confirm="start" />

    <RulesDialog v-if="showRules" @close="showRules = false" />
  </view>
</template>

<style>
.page {
  position: relative;
  min-height: 100vh;
  padding: 48rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 56rpx;
  box-sizing: border-box;
}
.rules-entry {
  position: absolute;
  top: 24rpx;
  right: 48rpx;
  padding: 16rpx;
  font-size: 26rpx;
  color: #a8a29e;
}
.hero {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 20rpx;
}
.stones {
  display: flex;
}
.stone {
  width: 56rpx;
  height: 56rpx;
  border-radius: 50%;
  box-shadow: 0 4rpx 8rpx rgba(0, 0, 0, 0.2);
}
.stone-black {
  background: radial-gradient(circle at 35% 30%, #57534e, #1c1917);
}
.stone-white {
  background: radial-gradient(circle at 35% 30%, #ffffff, #d6d3d1);
  margin-left: -16rpx;
}
.title {
  font-size: 52rpx;
  font-weight: 700;
  letter-spacing: 4rpx;
  color: #292524;
}
.tagline {
  font-size: 30rpx;
  font-weight: 500;
  color: #57534e;
}
.subtitle {
  font-size: 26rpx;
  color: #78716c;
}
.cards {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 16rpx;
}
.card {
  display: flex;
  align-items: center;
  gap: 28rpx;
  padding: 28rpx 36rpx;
  border-radius: 24rpx;
  background: rgba(255, 255, 255, 0.8);
  box-shadow: 0 2rpx 8rpx rgba(0, 0, 0, 0.04);
}
.card-icon {
  width: 72rpx;
  height: 72rpx;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: rgba(217, 180, 130, 0.3);
  font-size: 32rpx;
}
.card-body {
  display: flex;
  flex-direction: column;
  gap: 6rpx;
}
.card-title {
  font-size: 28rpx;
  font-weight: 600;
  color: #292524;
}
.card-text {
  font-size: 24rpx;
  color: #78716c;
}
</style>
