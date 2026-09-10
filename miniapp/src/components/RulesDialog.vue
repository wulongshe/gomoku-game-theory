<script setup lang="ts">
import { onMounted, ref } from 'vue'
import Taro from '@tarojs/taro'
import { fullRules } from '@gomoku/branding'

const emit = defineEmits<{ close: [] }>()

const RULES = fullRules('ai')

// 规则超出弹窗高度时提示可下滑，滚到接近底部即淡出。
const HINT_THRESHOLD_PX = 24
const scrollHint = ref(false)
let viewHeight = 0

type ScrollMetrics = { height: number; scrollTop: number; scrollHeight: number }

function measure(): void {
  Taro.createSelectorQuery()
    .select('#rules-body')
    .fields({ size: true, scrollOffset: true }, (res) => {
      const m = res as ScrollMetrics | null
      if (!m) return
      viewHeight = m.height
      scrollHint.value = m.scrollHeight - m.height - m.scrollTop > HINT_THRESHOLD_PX
    })
    .exec()
}

function onScroll(e: { detail: { scrollTop: number; scrollHeight: number } }): void {
  scrollHint.value = e.detail.scrollHeight - viewHeight - e.detail.scrollTop > HINT_THRESHOLD_PX
}

onMounted(() => Taro.nextTick(measure))
</script>

<template>
  <view class="mask" @tap="emit('close')">
    <view class="panel" @tap.stop>
      <view class="panel-head">
        <text class="panel-title">游戏规则</text>
        <text class="panel-close" @tap="emit('close')">✕</text>
      </view>
      <scroll-view id="rules-body" class="body" scroll-y @scroll="onScroll">
        <view v-for="section in RULES" :key="section.title" class="section">
          <text class="section-title">{{ section.title }}</text>
          <view v-for="item in section.items" :key="item" class="item">
            <text class="bullet">•</text>
            <text class="item-text">{{ item }}</text>
          </view>
        </view>
      </scroll-view>
      <view class="scroll-hint" :class="{ 'scroll-hint-on': scrollHint }">
        <text>下滑查看更多</text>
        <view class="chevron" />
      </view>
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
  position: relative;
  width: 100%;
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  gap: 40rpx;
  padding: 48rpx;
  border-radius: 32rpx;
  background: #ffffff;
  box-shadow: 0 20rpx 50rpx rgba(0, 0, 0, 0.15);
  box-sizing: border-box;
  overflow: hidden;
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
  max-height: 60vh;
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
.scroll-hint {
  pointer-events: none;
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4rpx;
  padding: 80rpx 0 12rpx;
  background: linear-gradient(to top, #ffffff, rgba(255, 255, 255, 0.7), transparent);
  font-size: 24rpx;
  color: #78716c;
  opacity: 0;
  transition: opacity 0.3s;
}
.scroll-hint-on {
  opacity: 1;
}
.chevron {
  width: 14rpx;
  height: 14rpx;
  border-right: 3rpx solid currentColor;
  border-bottom: 3rpx solid currentColor;
  transform: rotate(45deg);
  animation: bounce 1s infinite;
}
@keyframes bounce {
  0%,
  100% {
    transform: translateY(-25%) rotate(45deg);
    animation-timing-function: cubic-bezier(0.8, 0, 1, 1);
  }
  50% {
    transform: translateY(0) rotate(45deg);
    animation-timing-function: cubic-bezier(0, 0, 0.2, 1);
  }
}
</style>
