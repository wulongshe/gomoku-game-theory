import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

const RPX_SCALE = 40
const CUSTOM_TAGS = new Set(['view', 'scroll-view'])

type TemplateNode = {
  type: number
  tag?: string
  props?: { type: number; name: string; arg?: { content: string }; exp?: { content: string } }[]
}

// 小程序模板 → DOM：image 改 img、tap 改 click，:style 改成 v-rpx-style 指令在运行时换算 rpx。
function domTransform(node: TemplateNode): void {
  if (node.type !== 1) return
  if (node.tag === 'image') node.tag = 'img'
  for (const prop of node.props ?? []) {
    if (prop.type !== 7 || !prop.arg) continue
    if (prop.name === 'on' && prop.arg.content === 'tap') prop.arg.content = 'click'
    if (prop.name === 'bind' && prop.arg.content === 'style') {
      prop.name = 'rpx-style'
      prop.arg = undefined
    }
  }
}

const rpxToRem = {
  postcssPlugin: 'rpx-to-rem',
  Declaration(decl: { value: string }) {
    decl.value = decl.value.replace(/(-?\d*\.?\d+)rpx/g, (_, n: string) => `${Number(n) / RPX_SCALE}rem`)
  },
  Rule(rule: { selector: string }) {
    if (rule.selector === 'page') rule.selector = 'body'
  },
}

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  publicDir: 'public',
  plugins: [
    vue({
      template: {
        compilerOptions: {
          isCustomElement: (tag) => CUSTOM_TAGS.has(tag),
          nodeTransforms: [domTransform],
        },
      },
    }),
  ],
  resolve: {
    alias: {
      '@tarojs/taro': fileURLToPath(new URL('./taro.ts', import.meta.url)),
      '@': fileURLToPath(new URL('../src', import.meta.url)),
    },
  },
  css: { postcss: { plugins: [rpxToRem] } },
  build: {
    outDir: fileURLToPath(new URL('../dist-h5', import.meta.url)),
    emptyOutDir: true,
    target: ['es2017', 'chrome61'],
    cssCodeSplit: false,
    sourcemap: false,
    rollupOptions: {
      input: fileURLToPath(new URL('./main.ts', import.meta.url)),
      output: {
        format: 'iife',
        entryFileNames: 'assets/app.js',
        assetFileNames: 'assets/app[extname]',
        inlineDynamicImports: true,
      },
    },
  },
})
