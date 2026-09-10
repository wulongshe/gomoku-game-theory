<script setup lang="ts">
import { fullRules } from '@gomoku/branding'

const emit = defineEmits<{ close: [] }>()

const RULES = fullRules('ai')
</script>

<template>
  <view class="mask" @tap="emit('close')">
    <view class="panel" @tap.stop>
      <view class="panel-head">
        <text class="panel-title">游戏规则</text>
        <text class="panel-close" @tap="emit('close')">✕</text>
      </view>
      <scroll-view class="body" scroll-y>
        <view v-for="section in RULES" :key="section.title" class="section">
          <text class="section-title">{{ section.title }}</text>
          <view v-for="item in section.items" :key="item" class="item">
            <text class="bullet">•</text>
            <text class="item-text">{{ item }}</text>
          </view>
        </view>
      </scroll-view>
    </view>
  </view>
</template>

<style>
.mask {
  position: fixed;
  inset: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 32rpx;
  background: rgba(0, 0, 0, 0.4);
}
.panel {
  width: 100%;
  max-height: 92vh;
  display: flex;
  flex-direction: column;
  gap: 32rpx;
  padding: 40rpx;
  border-radius: 32rpx;
  background: #ffffff;
  box-shadow: 0 20rpx 50rpx rgba(0, 0, 0, 0.15);
  box-sizing: border-box;
}
.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.panel-title {
  font-size: 36rpx;
  font-weight: 600;
  color: #292524;
}
.panel-close {
  padding: 8rpx;
  margin: -8rpx;
  font-size: 28rpx;
  color: #a8a29e;
}
.body {
  flex: 1;
  min-height: 0;
  max-height: 78vh;
}
.section {
  display: flex;
  flex-direction: column;
  gap: 16rpx;
  margin-bottom: 40rpx;
}
.section:last-child {
  margin-bottom: 0;
}
.section-title {
  font-size: 28rpx;
  font-weight: 600;
  color: #292524;
}
.item {
  display: flex;
  gap: 16rpx;
}
.bullet {
  color: #d6d3d1;
}
.item-text {
  flex: 1;
  font-size: 28rpx;
  line-height: 1.5;
  color: #78716c;
}
</style>
