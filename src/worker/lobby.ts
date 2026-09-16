import { DurableObject } from 'cloudflare:workers'
import { FRAME_OPTIONS, type LobbyServerMessage } from '@/shared/protocol'
import { RATING_DEFAULT } from './accounts'
import { allocateRoom } from './roomCode'

export interface MatchOptions {
  frames: number[]
  rating: number
}

interface Waiter extends MatchOptions {
  joinedAt: number
  aiAt: number
}

// 允许的初始分差，等待越久放得越宽，直到能与任何人成局。
const BASE_TOLERANCE = 120
const WIDEN_PER_SEC = 40
const RECHECK_MS = 3000

// 久等无人时悄悄换 AI 顶替。到点时间在区间内随机且偏前（平方随机）：
// 多数人等 5~12s 就有「对手」，少数拖到更晚，避免固定时长或均匀分布露馅。
const AI_FALLBACK_MIN_MS = 5_000
const AI_FALLBACK_MAX_MS = 30_000

export function parseMatchOptions(params: URLSearchParams): MatchOptions | null {
  const list = (name: string) => [...new Set((params.get(name) ?? '').split(',').filter(Boolean))]
  const frames = list('frames').map(Number)
  if (!frames.length || frames.some((f) => !FRAME_OPTIONS.includes(f))) return null
  const raw = params.get('rating')
  const rating = raw !== null && Number.isFinite(Number(raw)) ? Number(raw) : RATING_DEFAULT
  return { frames, rating }
}

export function pickFrame(frames: number[], rng: () => number = Math.random): number {
  return frames[Math.min(frames.length - 1, Math.floor(rng() * frames.length))]
}

export function tolerance(waitedMs: number): number {
  return BASE_TOLERANCE + (waitedMs / 1000) * WIDEN_PER_SEC
}

function frameOverlap(a: MatchOptions, b: MatchOptions): number[] {
  return a.frames.filter((f) => b.frames.includes(f))
}

export class Lobby extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 })
    }
    const options = parseMatchOptions(new URL(request.url).searchParams)
    if (!options) {
      return new Response('Invalid options', { status: 400 })
    }
    const pair = new WebSocketPair()
    this.ctx.acceptWebSocket(pair[1])
    const joinedAt = Date.now()
    const aiAt =
      joinedAt + AI_FALLBACK_MIN_MS + Math.random() ** 2 * (AI_FALLBACK_MAX_MS - AI_FALLBACK_MIN_MS)
    pair[1].serializeAttachment({ ...options, joinedAt, aiAt } satisfies Waiter)
    await this.matchWaiting()
    return new Response(null, { status: 101, webSocket: pair[0] })
  }

  async alarm(): Promise<void> {
    await this.matchWaiting()
  }

  private async matchWaiting(): Promise<void> {
    const now = Date.now()
    const waiting = this.ctx.getWebSockets().map((ws) => ({
      ws,
      opts: ws.deserializeAttachment() as Waiter,
    }))

    const pairs: Array<{
      i: number
      j: number
      frames: number[]
      gap: number
      inBand: boolean
    }> = []
    for (let i = 0; i < waiting.length; i++) {
      for (let j = i + 1; j < waiting.length; j++) {
        const frames = frameOverlap(waiting[i].opts, waiting[j].opts)
        if (!frames.length) continue
        const gap = Math.abs(waiting[i].opts.rating - waiting[j].opts.rating)
        const reach = Math.max(
          tolerance(now - waiting[i].opts.joinedAt),
          tolerance(now - waiting[j].opts.joinedAt),
        )
        pairs.push({ i, j, frames, gap, inBand: gap <= reach })
      }
    }

    const used = new Set<WebSocket>()
    const matchable = pairs
      .filter((p) => p.inBand)
      .sort((a, b) => a.gap - b.gap || a.frames.length - b.frames.length)
    for (const { i, j, frames } of matchable) {
      if (used.has(waiting[i].ws) || used.has(waiting[j].ws)) continue
      used.add(waiting[i].ws)
      used.add(waiting[j].ws)
      const code = await allocateRoom(this.env, pickFrame(frames), 'forbidden', { matched: true })
      const matched = JSON.stringify({ type: 'matched', code } satisfies LobbyServerMessage)
      for (const ws of [waiting[i].ws, waiting[j].ws]) {
        try {
          ws.send(matched)
          ws.close(1000, 'matched')
        } catch {}
      }
    }

    // 到点仍没匹配上的，分一间 AI 房顶替真人（消息与真人匹配完全一致）。
    for (const { ws, opts } of waiting) {
      if (used.has(ws) || now < opts.aiAt) continue
      used.add(ws)
      const code = await allocateRoom(this.env, pickFrame(opts.frames), 'forbidden', {
        ai: true,
        matched: true,
      })
      try {
        ws.send(JSON.stringify({ type: 'matched', code } satisfies LobbyServerMessage))
        ws.close(1000, 'matched')
      } catch {}
    }

    // 仍有选项相容却暂时分差过大的组合时，定时放宽后重试；否则等到最早的 AI 顶替时点。
    const remaining = waiting.filter((w) => !used.has(w.ws))
    if (remaining.length === 0) {
      return this.ctx.storage.deleteAlarm()
    }
    const widenable = pairs.some(
      (p) => !used.has(waiting[p.i].ws) && !used.has(waiting[p.j].ws),
    )
    const nextAi = Math.min(...remaining.map((w) => w.opts.aiAt))
    await this.ctx.storage.setAlarm(widenable ? Math.min(now + RECHECK_MS, nextAi) : nextAi)
  }
}
