import { createApp } from 'vue'
import Page from '@/pages/index/index.vue'
import '@/app.css'
import './h5.css'

// 750rpx 设计稿：根字号 = 视口宽 / 750 × 40，1rpx = 1/40rem；超过 600px 的宽屏按手机宽度居中。
const RPX_SCALE = 40
const MAX_WIDTH = 600

function applyRootFontSize(): void {
  const width = Math.min(window.innerWidth, MAX_WIDTH)
  document.documentElement.style.fontSize = `${(width / 750) * RPX_SCALE}px`
}
applyRootFontSize()
window.addEventListener('resize', applyRootFontSize)

function applyStyle(el: HTMLElement, { value }: { value: unknown }): void {
  el.style.cssText =
    typeof value === 'string'
      ? value.replace(/(-?\d*\.?\d+)rpx/g, (_, n: string) => `${Number(n) / RPX_SCALE}rem`)
      : ''
}

createApp(Page)
  .directive('rpx-style', { beforeMount: applyStyle, updated: applyStyle })
  .mount('#app')
