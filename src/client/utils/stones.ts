import type { Color } from '@gomoku/engine/melee'

// 各色棋子的渐变两端色与描边色（黑白沿用原棋子配色）。
export const STONE_PALETTE: Record<Color, { light: string; dark: string; edge: string }> = {
  black: { light: '#5a5a5a', dark: '#111111', edge: '#a8a29e' },
  white: { light: '#ffffff', dark: '#d6d3d1', edge: '#a8a29e' },
  purple: { light: '#c4b5fd', dark: '#7c3aed', edge: '#5b21b6' },
  yellow: { light: '#fde68a', dark: '#f59e0b', edge: '#b45309' },
  blue: { light: '#93c5fd', dark: '#2563eb', edge: '#1e3a8a' },
}

// 月饼轮廓：以原点为中心、lobes 个花边瓣的圆，外沿略鼓。
export function mooncakePath(r: number, lobes = 12): string {
  const inner = r * 0.9
  const bulge = r * 1.06
  const step = (Math.PI * 2) / lobes
  const pt = (radius: number, angle: number) =>
    `${(Math.cos(angle) * radius).toFixed(2)} ${(Math.sin(angle) * radius).toFixed(2)}`
  let d = `M ${pt(inner, 0)}`
  for (let i = 0; i < lobes; i++) {
    const mid = i * step + step / 2
    d += ` Q ${pt(bulge, mid)} ${pt(inner, (i + 1) * step)}`
  }
  return `${d} Z`
}
