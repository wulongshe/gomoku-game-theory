import { customAlphabet } from 'nanoid'
import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from '@/shared/protocol'

export { Room } from './room'

const CANONICAL_HOST = 'gomoku.recode.top'

const newRoomCode = customAlphabet(ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH)

async function handle(request: Request, env: Env, url: URL): Promise<Response> {
  if (url.pathname.startsWith('/api/')) {
    if (request.method === 'POST' && url.pathname === '/api/rooms') {
      return Response.json({ code: newRoomCode() })
    }
    const wsMatch = url.pathname.match(/^\/api\/rooms\/([A-Z0-9]{6})\/ws$/)
    if (wsMatch) {
      const stub = env.ROOM.get(env.ROOM.idFromName(wsMatch[1]))
      return stub.fetch(request)
    }
    return new Response('Not Found', { status: 404 })
  }
  return env.ASSETS.fetch(request)
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)

    if (url.hostname === CANONICAL_HOST && url.protocol === 'http:') {
      url.protocol = 'https:'
      return Response.redirect(url.toString(), 301)
    }

    const response = await handle(request, env, url)
    if (url.hostname !== CANONICAL_HOST || response.status === 101) {
      return response
    }
    const secured = new Response(response.body, response)
    secured.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
    return secured
  },
} satisfies ExportedHandler<Env>