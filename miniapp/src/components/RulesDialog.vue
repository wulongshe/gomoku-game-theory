<script setup lang="ts">
import { fullRules } from '@gomoku/branding'

const emit = defineEmits<{ close: [] }>()

const RULES = fullRules('ai')
</script>

<template>
  <view class="mask" @tap="emit('close')">
    <view class="panel" @tap.stop>
      <text class="panel-title">游戏规则</text>
      <scroll-view class="body" scroll-y>
        <view v-for="section in RULES" :key="section.title" class="section">
          <text class="section-title">{{ section.title }}</text>
          <view v-for="item in section.items" :key="item" class="item">
            <text class="bullet">•</text>
            <text class="item-text">{{ item }}</text>
          </view>
        </view>
      </scroll-view>
      <view class="btn btn-primary" @tap="emit('close')">知道了</view>
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
  padding: 48rpx;
  background: rgba(0, 0, 0, 0.4);
}
.panel {
  width: 100%;
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  gap: 24rpx;
  padding: 48rpx;
  border-radius: 32rpx;
  background: #ffffff;
  box-sizing: border-box;
}
.panel-title {
  font-size: 34rpx;
  font-weight: 700;
  color: #292524;
}
.body {
  flex: 1;
  min-height: 0;
  max-height: 60vh;
}
.section {
  display: flex;
  flex-direction: column;
  gap: 12rpx;
  margin-bottom: 32rpx;
}
.section-title {
  font-size: 28rpx;
  font-weight: 600;
  color: #292524;
}
.item {
  display: flex;
  gap: 12rpx;
}
.bullet {
  color: #d6d3d1;
}
.item-text {
  flex: 1;
  font-size: 26rpx;
  line-height: 1.6;
  color: #78716c;
}
</style>
