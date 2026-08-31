import { createApp } from 'vue'
import './app.css'

// 引擎时间盒依赖 performance.now；小程序运行时可能未提供，缺失时以 Date.now 兜底。
if (typeof performance === 'undefined' || typeof performance.now !== 'function') {
  ;(globalThis as unknown as { performance: { now(): number } }).performance = {
    now: () => Date.now(),
  }
}

const App = createApp({})

export default App
