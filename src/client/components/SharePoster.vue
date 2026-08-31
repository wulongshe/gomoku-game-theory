<script setup lang="ts">
import { computed, ref } from 'vue'
import { encode } from 'uqr'
import IconStones from '~/components/icons/IconStones.vue'
import { MODE_LABELS, rules, SUBTITLE, TAGLINE, TITLE } from '@gomoku/branding'
import { frameLabel } from '~/utils/format'
import type { GameMode } from '@gomoku/engine/game'

const props = defineProps<{
  url: string
  code?: string
  frameSeconds?: number
  mode?: GameMode
}>()

const RULES = rules()

const W = 640
const H = 950
const QR_SIZE = 210
const QR_X = (W - QR_SIZE) / 2
const CARD_TOP = 556

// 竖向流式排布：卡片高度随实际内容（是否有房间号 / 对局信息）自动收缩。
const card = computed(() => {
  const hasSub = props.code !== undefined && props.frameSeconds !== undefined && props.mode
  let y = CARD_TOP + 36
  const labelY = props.code !== undefined ? y : 0
  if (props.code !== undefined) y += 18
  const qrY = y
  y += QR_SIZE
  const subY = hasSub ? y + 26 : 0
  y += hasSub ? 58 : 44
  const ctaY = y
  return { labelY, qrY, subY, ctaY, height: ctaY + 22 - CARD_TOP }
})

const qr = computed(() => encode(props.url, { border: 0 }))
const qrScale = computed(() => QR_SIZE / qr.value.size)
const qrPath = computed(() => {
  let d = ''
  qr.value.data.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (dark) d += `M${x} ${y}h1v1h-1z`
    }),
  )
  return d
})

const svgEl = ref<SVGSVGElement | null>(null)

async function toPngBlob(): Promise<Blob> {
  const xml = new XMLSerializer().serializeToString(svgEl.value!)
  const svgUrl = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml;charset=utf-8' }))
  try {
    const img = new Image()
    await new Promise((resolve, reject) => {
      img.onload = resolve
      img.onerror = reject
      img.src = svgUrl
    })
    const scale = 2
    const canvas = document.createElement('canvas')
    canvas.width = W * scale
    canvas.height = H * scale
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
    return await new Promise((resolve, reject) =>
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('toBlob failed'))), 'image/png'),
    )
  } finally {
    URL.revokeObjectURL(svgUrl)
  }
}

async function share() {
  const blob = await toPngBlob()
  const name = props.code ? `博弈五子棋-${props.code}` : '博弈五子棋'
  const file = new File([blob], `${name}.png`, { type: 'image/png' })
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] })
      return
    } catch (err) {
      if ((err as DOMException).name === 'AbortError') return
    }
  }
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = file.name
  a.click()
  URL.revokeObjectURL(a.href)
}

defineExpose({ share })
</script>

<template>
  <svg
    ref="svgEl"
    :width="W"
    :height="H"
    :viewBox="`0 0 ${W} ${H}`"
    xmlns="http://www.w3.org/2000/svg"
    font-family="system-ui, -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif"
  >
    <defs>
      <linearGradient id="poster-bg" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#f5f5f4" />
        <stop offset="100%" stop-color="#e7e5e4" />
      </linearGradient>
    </defs>

    <rect :width="W" :height="H" fill="url(#poster-bg)" />

    <IconStones x="284" y="54" width="72" height="47" />

    <text
      x="320"
      y="162"
      text-anchor="middle"
      font-size="46"
      font-weight="700"
      letter-spacing="4"
      fill="#292524"
    >
      {{ TITLE }}
    </text>
    <text x="320" y="206" text-anchor="middle" font-size="26" font-weight="500" fill="#57534e">
      {{ TAGLINE }}
    </text>
    <text x="320" y="240" text-anchor="middle" font-size="20" fill="#78716c">{{ SUBTITLE }}</text>

    <g v-for="(rule, i) in RULES" :key="rule.title">
      <rect x="70" :y="280 + i * 88" width="500" height="76" rx="16" fill="#ffffff" fill-opacity="0.8" />
      <circle cx="112" :cy="318 + i * 88" r="18" fill="#e0b26e" fill-opacity="0.3" />
      <text x="112" :y="325 + i * 88" text-anchor="middle" font-size="20">{{ rule.icon }}</text>
      <text x="150" :y="313 + i * 88" font-size="22" font-weight="600" fill="#292524">
        {{ rule.title }}
      </text>
      <text x="150" :y="341 + i * 88" font-size="16" fill="#78716c">{{ rule.text }}</text>
    </g>

    <rect :x="170" :y="CARD_TOP" width="300" :height="card.height" rx="24" fill="#ffffff" fill-opacity="0.8" />
    <text v-if="code" x="320" :y="card.labelY" text-anchor="middle" font-size="18" letter-spacing="3" fill="#78716c">
      房间 {{ code }}
    </text>
    <g :transform="`translate(${QR_X} ${card.qrY}) scale(${qrScale})`">
      <path :d="qrPath" fill="#292524" />
    </g>
    <text
      v-if="code && frameSeconds !== undefined && mode"
      x="320"
      :y="card.subY"
      text-anchor="middle"
      font-size="18"
      letter-spacing="3"
      fill="#78716c"
    >
      每回合 {{ frameLabel(frameSeconds) }} · {{ MODE_LABELS[mode] }}模式
    </text>
    <text x="320" :y="card.ctaY" text-anchor="middle" font-size="22" font-weight="600" fill="#292524">
      {{ code ? '扫码进房，来一局' : '扫码即玩，来一局' }}
    </text>

    <text x="320" y="932" text-anchor="middle" font-size="16" fill="#a8a29e">
      免下载 · 免注册，10 秒开局
    </text>
  </svg>
</template>
