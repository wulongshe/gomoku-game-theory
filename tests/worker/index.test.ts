import { SELF } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { ROOM_CODE_PATTERN } from '@/shared/protocol'

describe('https enforcement', () => {
  it('redirects http on the canonical host to https', async () => {
    const res = await SELF.fetch('http://gomoku.recode.top/api/rooms', {
      method: 'POST',
      redirect: 'manual',
    })
    expect(res.status).toBe(301)
    expect(res.headers.get('Location')).toBe('https://gomoku.recode.top/api/rooms')
  })

  it('adds HSTS on canonical-host responses and skips other hosts', async () => {
    const canonical = await SELF.fetch('https://gomoku.recode.top/api/rooms', { method: 'POST' })
    expect(canonical.headers.get('Strict-Transport-Security')).toContain('max-age=')
    const other = await SELF.fetch('https://example.com/api/rooms', { method: 'POST' })
    expect(other.headers.get('Strict-Transport-Security')).toBeNull()
  })
})

describe('POST /api/rooms', () => {
  it('returns a short room code and marks the room as created', async () => {
    const res = await SELF.fetch('https://example.com/api/rooms', { method: 'POST' })
    expect(res.status).toBe(200)
    const { code } = await res.json<{ code: string }>()
    expect(code).toMatch(ROOM_CODE_PATTERN)
    const check = await SELF.fetch(`https://example.com/api/rooms/${code}`)
    expect(await check.json()).toEqual({ exists: true, full: false })
  })

  it('rejects an unsupported frame duration', async () => {
    const res = await SELF.fetch('https://example.com/api/rooms?frame=45', { method: 'POST' })
    expect(res.status).toBe(400)
  })
})

describe('GET /api/match/ws', () => {
  it('rejects missing or unsupported option lists', async () => {
    for (const query of ['', '?frames=30', '?frames=45&modes=forbidden', '?frames=30&modes=classic']) {
      const res = await SELF.fetch(`https://example.com/api/match/ws${query}`, {
        headers: { Upgrade: 'websocket' },
      })
      expect(res.status).toBe(400)
    }
  })
})

describe('GET /api/rooms/:code', () => {
  it('reports a never-created room as missing', async () => {
    const res = await SELF.fetch('https://example.com/api/rooms/ZZZZZ2')
    expect(await res.json()).toEqual({ exists: false, full: false })
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
