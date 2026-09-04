import { describe, expect, it } from 'vitest'
import { botPersona, parseBotPool } from '../../src/worker/bots'

describe('botPersona', () => {
  const ROSTER = 'alice@x.com,speed:0.7,grit:0.95,drawish:0.08;bob@x.com,speed:1.4;carol@x.com'

  it('extracts just the emails for the pool, traits and all', () => {
    expect(parseBotPool(ROSTER)).toEqual(['alice@x.com', 'bob@x.com', 'carol@x.com'])
  })

  it('parses per-bot overrides merged into the roster', () => {
    const p = botPersona(ROSTER, 'alice@x.com')
    expect(p).toEqual({ speed: 0.7, grit: 0.95, drawish: 0.08 })
  })

  it('fills unspecified keys from the identity default', () => {
    const p = botPersona(ROSTER, 'bob@x.com')
    expect(p.speed).toBe(1.4)
    expect(p.grit).toBeGreaterThan(0)
    expect(p.drawish).toBeGreaterThan(0)
  })

  it('derives a stable individual persona when unconfigured', () => {
    const a = botPersona(ROSTER, 'carol@x.com')
    const b = botPersona(ROSTER, 'carol@x.com')
    const c = botPersona(ROSTER, 'other@x.com')
    expect(a).toEqual(b)
    expect(a).not.toEqual(c)
  })

  it('gives the anonymous fallback AI a neutral persona', () => {
    expect(botPersona(ROSTER, null)).toEqual({ speed: 1, drawish: 0.12, grit: 0.82 })
  })

  it('clamps out-of-range values from a misconfigured entry', () => {
    const p = botPersona('x@x.com,speed:99,grit:-3,drawish:5', 'x@x.com')
    expect(p.speed).toBe(2.5)
    expect(p.grit).toBe(0)
    expect(p.drawish).toBe(1)
  })
})
