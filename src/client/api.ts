export async function createRoom(): Promise<string> {
  const res = await fetch('/api/rooms', { method: 'POST' })
  if (!res.ok) throw new Error(`createRoom failed: ${res.status}`)
  const { code } = (await res.json()) as { code: string }
  return code
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
