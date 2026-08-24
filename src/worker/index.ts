import { FRAME_SECONDS } from '@/engine/game'
import { FRAME_OPTIONS } from '@/shared/protocol'
import { newRoomCode } from './roomCode'

export { Room } from './room'
export { Lobby } from './lobby'

const CANONICAL_HOST = 'gomoku.recode.top'

async function handle(request: Request, env: Env, url: URL): Promise<Response> {
  if (url.pathname.startsWith('/api/')) {
    const frame = Number(url.searchParams.get('frame') ?? FRAME_SECONDS)
    if (request.method === 'POST' && url.pathname === '/api/rooms') {
      if (!FRAME_OPTIONS.includes(frame)) {
        return new Response('Invalid frame', { status: 400 })
      }
      const code = newRoomCode()
      await env.ROOM.get(env.ROOM.idFromName(code)).fetch(`https://room/create?frame=${frame}`, {
        method: 'POST',
      })
      return Response.json({ code })
    }
    if (url.pathname === '/api/match/ws') {
      if (!FRAME_OPTIONS.includes(frame)) {
        return new Response('Invalid frame', { status: 400 })
      }
      return env.LOBBY.get(env.LOBBY.idFromName('lobby')).fetch(request)
    }
    const roomMatch = url.pathname.match(/^\/api\/rooms\/([A-Z0-9]{6})(\/ws)?$/)
    if (roomMatch && request.method === 'GET') {
      return env.ROOM.get(env.ROOM.idFromName(roomMatch[1])).fetch(request)
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