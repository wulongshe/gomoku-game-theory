<script setup lang="ts">
import { computed, ref } from 'vue'
import type { Difficulty } from '@gomoku/engine/ai'
import type { GameMode } from '@gomoku/engine/game'
import {
  AI_MODE_OPTIONS,
  DEFAULT_HELL_STRENGTH,
  DIFFICULTY_LABELS,
  DIFFICULTY_OPTIONS,
  MODE_LABELS,
} from '@gomoku/branding'

export interface GameConfig {
  mode: GameMode
  difficulty: Difficulty
  strength: number
}

const props = withDefaults(
  defineProps<{
    mode?: GameMode
    difficulty?: Difficulty
    strength?: number
  }>(),
  { mode: 'forbidden', difficulty: 'normal', strength: DEFAULT_HELL_STRENGTH },
)

const emit = defineEmits<{ cancel: []; confirm: [config: GameConfig] }>()

const mode = ref<GameMode>(props.mode)
const difficulty = ref<Difficulty>(props.difficulty)
const strengthPercent = ref(Math.round(props.strength * 100))

// 低难度偏绿、高难度偏红，与 web 端棋力滑条一致。
const fillColor = computed(
  () => `hsl(${Math.round((1 - strengthPercent.value / 100) * 130)}, 68%, 45%)`,
)

type SliderEvent = { detail: { value: number } }
function onStrength(e: SliderEvent): void {
  strengthPercent.value = e.detail.value
}

function confirm(): void {
  emit('confirm', {
    mode: mode.value,
    difficulty: difficulty.value,
    strength: strengthPercent.value / 100,
  })
}
</script>

<template>
  <view class="mask" @tap="emit('cancel')">
    <view class="panel" @tap.stop>
      <text class="panel-title">人机对战</text>

      <view class="field">
        <text class="field-label">撞子后</text>
        <view class="chips">
          <view
            v-for="m in AI_MODE_OPTIONS"
            :key="m"
            class="chip"
            :class="{ 'chip-on': m === mode }"
            @tap="mode = m"
          >
            {{ MODE_LABELS[m] }}
          </view>
        </view>
      </view>

      <view class="field">
        <text class="field-label">难度</text>
        <view class="chips">
          <view
            v-for="d in DIFFICULTY_OPTIONS"
            :key="d"
            class="chip"
            :class="{ 'chip-on': d === difficulty }"
            @tap="difficulty = d"
          >
            {{ DIFFICULTY_LABELS[d] }}
          </view>
        </view>
      </view>

      <view v-if="difficulty === 'hell'" class="field">
        <text class="field-label">{{ strengthPercent }} 点棋力</text>
        <slider
          class="slider"
          :min="5"
          :max="100"
          :step="5"
          :value="strengthPercent"
          :active-color="fillColor"
          block-size="20"
          @changing="onStrength"
          @change="onStrength"
        />
      </view>

      <view class="btn btn-primary" @tap="confirm">开始对战</view>
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
  display: flex;
  flex-direction: column;
  gap: 32rpx;
  padding: 48rpx;
  border-radius: 32rpx;
  background: #ffffff;
  box-sizing: border-box;
}
.panel-title {
  text-align: center;
  font-size: 34rpx;
  font-weight: 700;
  color: #292524;
}
.field {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16rpx;
}
.field-label {
  font-size: 26rpx;
  color: #78716c;
}
.chips {
  display: flex;
  gap: 12rpx;
  flex-wrap: wrap;
  justify-content: center;
}
.chip {
  padding: 10rpx 24rpx;
  border-radius: 999rpx;
  background: #f5f5f4;
  color: #57534e;
  border: 1px solid #e7e5e4;
  font-size: 26rpx;
}
.chip-on {
  background: #1c1917;
  color: #fafaf9;
  border-color: #1c1917;
}
.slider {
  width: 100%;
  margin: 0;
}
</style>
