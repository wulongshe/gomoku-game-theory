import { SELF } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { ROOM_CODE_PATTERN } from '../shared/protocol'

describe('POST /api/rooms', () => {
  it('returns a short room code', async () => {
    const res = await SELF.fetch('https://example.com/api/rooms', { method: 'POST' })
    expect(res.status).toBe(200)
    const { code } = await res.json<{ code: string }>()
    expect(code).toMatch(ROOM_CODE_PATTERN)
  })
})

describe('GET /api/rooms/:code/ws', () => {
  it('rejects non-websocket requests', async () => {
    const res = await SELF.fetch('https://example.com/api/rooms/AB3XY9/ws')
    expect(res.status).toBe(426)
  })

  it('404s on malformed codes', async () => {
    const res = await SELF.fetch('https://example.com/api/rooms/short/ws')
    expect(res.status).toBe(404)
  })
})
