export async function createRoom(frameSeconds: number): Promise<string> {
  const res = await fetch(`/api/rooms?frame=${frameSeconds}`, { method: 'POST' })
  if (!res.ok) throw new Error(`createRoom failed: ${res.status}`)
  const { code } = (await res.json()) as { code: string }
  return code
}

export interface RoomStatus {
  exists: boolean
  full: boolean
}

export async function roomStatus(code: string, token: string): Promise<RoomStatus> {
  const res = await fetch(`/api/rooms/${code}?token=${token}`)
  if (!res.ok) throw new Error(`roomStatus failed: ${res.status}`)
  return (await res.json()) as RoomStatus
}

export function roomWsUrl(code: string, token: string): string {
  return `${wsProto()}://${location.host}/api/rooms/${code}/ws?token=${token}`
}

export function matchWsUrl(frameSeconds: number): string {
  return `${wsProto()}://${location.host}/api/match/ws?frame=${frameSeconds}`
}

function wsProto(): string {
  return location.protocol === 'https:' ? 'wss' : 'ws'
}
