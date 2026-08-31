import path from 'node:path'
import { defineConfig } from '@tarojs/cli'
import devConfig from './dev'
import prodConfig from './prod'

// 引擎以 workspace 包 @gomoku/engine 引用，pnpm 链接后由 Taro/Vite 直接解析并编译其源码，无需手配路径。
// 其余项（sourceRoot/outputRoot/designWidth/deviceRatio/postcss 等）沿用 Taro 默认，不再重复声明。
export default defineConfig(async (merge, { mode }) => {
  const baseConfig = {
    projectName: 'gomoku-miniapp',
    sourceRoot: 'src',
    outputRoot: 'dist',
    framework: 'vue3',
    compiler: { type: 'vite' as const },
    plugins: ['@tarojs/plugin-platform-xhs'],
    alias: {
      '@': path.resolve(__dirname, '..', 'src'),
    },
  }

  if (mode === 'production') return merge({}, baseConfig, prodConfig)
  return merge({}, baseConfig, devConfig)
})
