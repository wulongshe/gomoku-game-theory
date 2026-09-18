<script setup lang="ts">
import { ref } from 'vue'
import type { Difficulty } from '@gomoku/engine/ai'
import { DIFFICULTY_LABELS } from '@gomoku/branding'
import { DIFFICULTY_OPTIONS } from '@gomoku/config'

const props = withDefaults(defineProps<{ difficulty?: Difficulty }>(), { difficulty: 'normal' })

const emit = defineEmits<{ cancel: []; confirm: [difficulty: Difficulty] }>()

const difficulty = ref<Difficulty>(props.difficulty)

function confirm(): void {
  emit('confirm', difficulty.value)
}
</script>

<template>
  <view class="mask" @tap="emit('cancel')">
    <view class="panel" @tap.stop>
      <view class="panel-head">
        <text class="panel-title">人机对战</text>
        <text class="panel-close" @tap="emit('cancel')">✕</text>
      </view>

      <view class="field">
        <text class="field-label">难度</text>
        <view class="seg">
          <view
            v-for="d in DIFFICULTY_OPTIONS"
            :key="d"
            class="seg-item"
            :class="{ 'seg-on': d === difficulty }"
            @tap="difficulty = d"
          >
            {{ DIFFICULTY_LABELS[d] }}
          </view>
        </view>
      </view>

      <view class="dialog-btn" @tap="confirm">开始对战</view>
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
  max-width: 640rpx;
  display: flex;
  flex-direction: column;
  gap: 32rpx;
  padding: 48rpx;
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
  font-size: 32rpx;
  font-weight: 600;
  color: #292524;
}
.panel-close {
  padding: 8rpx;
  margin: -8rpx;
  font-size: 28rpx;
  color: #a8a29e;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 16rpx;
}
.field-label {
  text-align: center;
  font-size: 28rpx;
  color: #78716c;
}
.seg {
  display: flex;
  padding: 4rpx;
  border-radius: 16rpx;
  background: #e7e5e4;
}
.seg-item {
  flex: 1;
  height: 56rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 12rpx;
  font-size: 28rpx;
  font-weight: 500;
  color: #78716c;
}
.seg-on {
  background: #ffffff;
  color: #292524;
  box-shadow: 0 2rpx 6rpx rgba(0, 0, 0, 0.08);
}
.dialog-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20rpx 0;
  border-radius: 24rpx;
  background: #292524;
  color: #ffffff;
  font-size: 30rpx;
  font-weight: 500;
}
</style>
