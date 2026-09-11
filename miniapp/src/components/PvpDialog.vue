<script setup lang="ts">
import { GROUP_INVITE, GROUP_NAME } from '@/community'

const emit = defineEmits<{ close: [] }>()
</script>

<template>
  <view class="mask" @tap="emit('close')">
    <view class="panel" @tap.stop>
      <view class="panel-head">
        <text class="panel-title">双人对战</text>
        <text class="panel-close" @tap="emit('close')">✕</text>
      </view>
      <text class="group-hint">当前版本只支持本地人机对战，暂不支持联网对战。</text>
      <text class="group-hint">想找人对弈，可以加入交流群「{{ GROUP_NAME }}」组队：长按复制下面这段邀请码，回到小红书首页即可加入。</text>
      <text class="group-invite" selectable>{{ GROUP_INVITE }}</text>
    </view>
  </view>
</template>

<style>
.group-hint {
  font-size: 26rpx;
  line-height: 1.5;
  color: #78716c;
}
.group-invite {
  padding: 24rpx;
  border-radius: 16rpx;
  background: #f5f5f4;
  font-size: 26rpx;
  line-height: 1.6;
  color: #292524;
  white-space: pre-wrap;
  word-break: break-all;
  -webkit-user-select: text;
  user-select: text;
}
</style>
