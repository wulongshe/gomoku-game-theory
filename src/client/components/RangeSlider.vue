<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{ min?: number; max?: number; step?: number; fill?: string }>(),
  { min: 0, max: 1, step: 1, fill: '#059669' },
)

const model = defineModel<number>({ required: true })

// --pct：已选值在 [min,max] 内的占比，决定填充长度与滑块位置对齐。
const style = computed(() => ({
  '--pct': `${((model.value - props.min) / (props.max - props.min)) * 100}%`,
  '--fill': props.fill,
}))

function onInput(event: Event): void {
  model.value = (event.target as HTMLInputElement).valueAsNumber
}
</script>

<template>
  <input
    type="range"
    :min="min"
    :max="max"
    :step="step"
    :value="model"
    :style="style"
    class="range w-full cursor-pointer"
    @input="onInput"
  />
</template>

<style scoped>
.range {
  --track: #e7e5e4;
  appearance: none;
  -webkit-appearance: none;
  height: 0.5rem;
  border-radius: 9999px;
  background: linear-gradient(to right, var(--fill) var(--pct), var(--track) var(--pct));
}
.range::-webkit-slider-thumb {
  appearance: none;
  -webkit-appearance: none;
  height: 1.15rem;
  width: 1.15rem;
  border-radius: 9999px;
  background: #fff;
  border: 3px solid var(--fill);
  box-shadow: 0 1px 3px rgb(0 0 0 / 0.25);
  transition: border-color 0.15s;
}
.range::-moz-range-track {
  height: 0.5rem;
  border-radius: 9999px;
  background: transparent;
}
.range::-moz-range-thumb {
  height: 1.15rem;
  width: 1.15rem;
  border: 3px solid var(--fill);
  border-radius: 9999px;
  background: #fff;
  box-shadow: 0 1px 3px rgb(0 0 0 / 0.25);
}
@media (prefers-color-scheme: dark) {
  .range {
    --track: #57534e;
  }
}
</style>
