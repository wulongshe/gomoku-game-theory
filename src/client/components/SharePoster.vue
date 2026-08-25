<script setup lang="ts">
import { computed, ref } from 'vue'
import { encode } from 'uqr'
import IconStones from '~/components/icons/IconStones.vue'
import { RULES, SUBTITLE, TAGLINE, TITLE } from '~/constants/branding'

const props = defineProps<{ url: string; code: string }>()

const W = 640
const H = 920
const QR_SIZE = 210
const QR_X = (W - QR_SIZE) / 2
const QR_Y = 590

const CARD_TEXT_MAX = 24

function textWidth(text: string): number {
  return [...text].reduce((sum, ch) => sum + (ch.codePointAt(0)! > 0xff ? 1 : 0.5), 0)
}

function wrapRuleText(text: string): string[] {
  const lines: string[] = []
  let current = ''
  for (const part of text.split(/(?<=[，；：])/)) {
    if (current && textWidth(current + part) > CARD_TEXT_MAX) {
      lines.push(current)
      current = part
    } else {
      current += part
    }
  }
  if (current) lines.push(current)
  return lines
}

const ruleLines = RULES.map((rule) => wrapRuleText(rule.text))

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
  const file = new File([blob], `博弈五子棋-${props.code}.png`, { type: 'image/png' })
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

    <IconStones x="284" y="44" width="72" height="47" />

    <text
      x="320"
      y="148"
      text-anchor="middle"
      font-size="46"
      font-weight="700"
      letter-spacing="4"
      fill="#292524"
    >
      {{ TITLE }}
    </text>
    <text x="320" y="190" text-anchor="middle" font-size="26" font-weight="500" fill="#57534e">
      {{ TAGLINE }}
    </text>
    <text x="320" y="222" text-anchor="middle" font-size="20" fill="#78716c">{{ SUBTITLE }}</text>

    <g v-for="(rule, i) in RULES" :key="rule.title">
      <rect x="70" :y="256 + i * 102" width="500" height="92" rx="16" fill="#ffffff" fill-opacity="0.8" />
      <circle cx="112" :cy="302 + i * 102" r="18" fill="#e0b26e" fill-opacity="0.3" />
      <text x="112" :y="309 + i * 102" text-anchor="middle" font-size="20">{{ rule.icon }}</text>
      <text x="150" :y="290 + i * 102" font-size="22" font-weight="600" fill="#292524">
        {{ rule.title }}
      </text>
      <text
        v-for="(line, j) in ruleLines[i]"
        :key="line"
        x="150"
        :y="316 + i * 102 + j * 22"
        font-size="16"
        fill="#78716c"
      >
        {{ line }}
      </text>
    </g>

    <rect x="170" y="568" width="300" height="316" rx="24" fill="#ffffff" fill-opacity="0.8" />
    <g :transform="`translate(${QR_X} ${QR_Y}) scale(${qrScale})`">
      <path :d="qrPath" fill="#292524" />
    </g>
    <text x="320" y="832" text-anchor="middle" font-size="22" font-weight="600" fill="#292524">
      扫码进房，来一局
    </text>
    <text x="320" y="862" text-anchor="middle" font-size="18" letter-spacing="3" fill="#78716c">
      房间 {{ code }}
    </text>

    <text x="320" y="902" text-anchor="middle" font-size="16" fill="#a8a29e">
      免下载 · 免注册，10 秒开局
    </text>
  </svg>
</template>
