import Taro from '@tarojs/taro'

// 小程序里 100vh 未必等于可视区高度（不同基础库对 page 高度处理不一），
// 直接取窗口高度做页面的 min-height，保证首页垂直居中、对战页底栏贴底；取不到时留给 CSS 的 100vh 兜底。
function windowHeightPx(): number {
  try {
    return Taro.getSystemInfoSync().windowHeight
  } catch {
    return 0
  }
}

const height = windowHeightPx()
export const PAGE_MIN_HEIGHT = height ? `min-height:${height}px` : ''
