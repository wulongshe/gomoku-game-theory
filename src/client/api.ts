export async function createRoom(): Promise<string> {
  const res = await fetch('/api/rooms', { method: 'POST' })
  if (!res.ok) throw new Error(`createRoom failed: ${res.status}`)
  const { code } = (await res.json()) as { code: string }
  return code
}

export async function roomExists(code: string): Promise<boolean> {
  const res = await fetch(`/api/rooms/${code}`)
  if (!res.ok) throw new Error(`roomExists failed: ${res.status}`)
  const { exists } = (await res.json()) as { exists: boolean }
  return exists
}

export function roomWsUrl(code: string, token: string): string {
  return `${wsProto()}://${location.host}/api/rooms/${code}/ws?token=${token}`
}

export function matchWsUrl(): string {
  return `${wsProto()}://${location.host}/api/match/ws`
}

function wsProto(): string {
  return location.protocol === 'https:' ? 'wss' : 'ws'
}
