import type { GameMode } from '@/engine/game'

export async function createRoom(frameSeconds: number, mode: GameMode): Promise<string> {
  const res = await fetch(`/api/rooms?frame=${frameSeconds}&mode=${mode}`, { method: 'POST' })
  if (!res.ok) throw new Error(`createRoom failed: ${res.status}`)
  const { code } = (await res.json()) as { code: string }
  return code
}

export interface RoomStatus {
  exists: boolean
  full: boolean
}

export async function roomStatus(code: string, token: string, auth?: string): Promise<RoomStatus> {
  const res = await fetch(`/api/rooms/${code}?token=${token}${auth ? `&auth=${auth}` : ''}`)
  if (!res.ok) throw new Error(`roomStatus failed: ${res.status}`)
  return (await res.json()) as RoomStatus
}

export function roomWsUrl(code: string, token: string, auth?: string): string {
  return `${wsProto()}://${location.host}/api/rooms/${code}/ws?token=${token}${auth ? `&auth=${auth}` : ''}`
}

export function matchWsUrl(frames: number[], modes: GameMode[], auth?: string): string {
  const query = `frames=${frames.join(',')}&modes=${modes.join(',')}${auth ? `&auth=${auth}` : ''}`
  return `${wsProto()}://${location.host}/api/match/ws?${query}`
}

function wsProto(): string {
  return location.protocol === 'https:' ? 'wss' : 'ws'
}

export interface LeaderboardEntry {
  email: string
  wins: number
  losses: number
  draws: number
}

export async function fetchLeaderboard(): Promise<LeaderboardEntry[]> {
  const res = await fetch('/api/leaderboard')
  if (!res.ok) throw new Error(`fetchLeaderboard failed: ${res.status}`)
  return (await res.json()) as LeaderboardEntry[]
}

export class AuthError extends Error {
  constructor(public code: string) {
    super(code)
  }
}

async function authPost<T>(path: string, body: object): Promise<T> {
  const res = await fetch(`/api/auth/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: string } | null
    throw new AuthError(data?.error ?? 'unknown')
  }
  return (await res.json()) as T
}

export interface AuthSession {
  token: string
  email: string
}

export function authRegister(email: string): Promise<{ ok: true }> {
  return authPost('register', { email })
}

export function authVerify(email: string, code: string, password: string): Promise<AuthSession> {
  return authPost('verify', { email, code, password })
}

export function authLogin(email: string, password: string): Promise<AuthSession> {
  return authPost('login', { email, password })
}

export interface EmailVisibility {
  leaderboard: boolean
  game: boolean
}

export interface AuthProfile {
  email: string
  emailVisibility: EmailVisibility
}

export async function authMe(token: string): Promise<AuthProfile | null> {
  const res = await fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } })
  if (res.status === 401) return null
  if (!res.ok) throw new Error(`authMe failed: ${res.status}`)
  return (await res.json()) as AuthProfile
}

export async function authSetEmailVisible(
  token: string,
  scope: keyof EmailVisibility,
  visible: boolean,
): Promise<void> {
  const res = await fetch('/api/auth/visibility', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ scope, visible }),
  })
  if (!res.ok) throw new Error(`authSetEmailVisible failed: ${res.status}`)
}

export async function authLogout(token: string): Promise<void> {
  await fetch('/api/auth/logout', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  })
}
