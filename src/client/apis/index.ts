import type { GameMode } from '@gomoku/engine/game'
import type { TournamentInfo } from '@/shared/protocol'
import { useAuthToken } from '~/composables/useAuthToken'

const authToken = useAuthToken()

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

// key 为房间席位钥匙（每房独立），账号鉴权由 authQuery 从存储补上。
export async function roomStatus(code: string, key: string): Promise<RoomStatus> {
  const res = await fetch(`/api/rooms/${code}?key=${key}${authQuery()}`)
  if (!res.ok) throw new Error(`roomStatus failed: ${res.status}`)
  return (await res.json()) as RoomStatus
}

export function roomWsUrl(code: string, key: string): string {
  return `${wsProto()}://${location.host}/api/rooms/${code}/ws?key=${key}${authQuery()}`
}

// 大赛观战连接：无席位钥匙，凭账号 token 由服务端校验资格。
export function spectateWsUrl(code: string): string {
  return `${wsProto()}://${location.host}/api/rooms/${code}/ws?spectate=1${authQuery()}`
}

export function matchWsUrl(frames: number[]): string {
  const query = `frames=${frames.join(',')}${authQuery()}`
  return `${wsProto()}://${location.host}/api/match/ws?${query}`
}

function wsProto(): string {
  return location.protocol === 'https:' ? 'wss' : 'ws'
}

// 账号鉴权统一从持久化 token 读取（游客为空则省略），无需业务侧传入。
function authQuery(): string {
  return authToken.value ? `&token=${authToken.value}` : ''
}

function bearer(): Record<string, string> {
  return authToken.value ? { Authorization: `Bearer ${authToken.value}` } : {}
}

export interface LeaderboardEntry {
  email: string
  wins: number
  losses: number
  draws: number
}

export interface Leaderboard {
  entries: LeaderboardEntry[]
  me: number | null // 我在榜中的下标，由服务端在脱敏前定位
}

export async function fetchLeaderboard(): Promise<Leaderboard> {
  const res = await fetch('/api/leaderboard', { headers: bearer() })
  if (!res.ok) throw new Error(`fetchLeaderboard failed: ${res.status}`)
  return (await res.json()) as Leaderboard
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

export interface AuthProfile {
  email: string
  emailVisible: boolean
}

export async function authMe(): Promise<AuthProfile | null> {
  const res = await fetch('/api/auth/me', { headers: bearer() })
  if (res.status === 401) return null
  if (!res.ok) throw new Error(`authMe failed: ${res.status}`)
  return (await res.json()) as AuthProfile
}

export async function authSetEmailVisible(visible: boolean): Promise<void> {
  const res = await fetch('/api/auth/visibility', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...bearer() },
    body: JSON.stringify({ visible }),
  })
  if (!res.ok) throw new Error(`authSetEmailVisible failed: ${res.status}`)
}

export async function authLogout(): Promise<void> {
  await fetch('/api/auth/logout', { method: 'POST', headers: bearer() })
}

export async function fetchTournament(): Promise<TournamentInfo> {
  const res = await fetch('/api/tournament', { headers: bearer() })
  if (!res.ok) throw new Error(`fetchTournament failed: ${res.status}`)
  return (await res.json()) as TournamentInfo
}

export function tournamentWsUrl(): string {
  const token = authToken.value ? `?token=${authToken.value}` : ''
  return `${wsProto()}://${location.host}/api/tournament/ws${token}`
}

async function tournamentAction(
  action: 'register' | 'withdraw' | 'seek' | 'unseek',
): Promise<TournamentInfo> {
  const res = await fetch(`/api/tournament/${action}`, { method: 'POST', headers: bearer() })
  if (!res.ok) throw new Error(`${action}Tournament failed: ${res.status}`)
  return (await res.json()) as TournamentInfo
}

export function registerTournament(): Promise<TournamentInfo> {
  return tournamentAction('register')
}

export function withdrawTournament(): Promise<TournamentInfo> {
  return tournamentAction('withdraw')
}

export function seekTournamentMatch(): Promise<TournamentInfo> {
  return tournamentAction('seek')
}

export function cancelTournamentSeek(): Promise<TournamentInfo> {
  return tournamentAction('unseek')
}
