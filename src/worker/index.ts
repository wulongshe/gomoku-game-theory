import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from '@/shared/protocol'

export { Room } from './room'

function newRoomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(ROOM_CODE_LENGTH))
  return [...bytes].map((b) => ROOM_CODE_ALPHABET[b % ROOM_CODE_ALPHABET.length]).join('')
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)

    if (request.method === 'POST' && url.pathname === '/api/rooms') {
      return Response.json({ code: newRoomCode() })
    }

    const wsMatch = url.pathname.match(/^\/api\/rooms\/([A-Z0-9]{6})\/ws$/)
    if (wsMatch) {
      const stub = env.ROOM.get(env.ROOM.idFromName(wsMatch[1]))
      return stub.fetch(request)
    }

    return new Response('Not Found', { status: 404 })
  },
} satisfies ExportedHandler<Env>
