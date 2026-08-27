import { FRAME_SECONDS, type GameMode } from '@/engine/game'
import { EMAIL_PATTERN, FRAME_OPTIONS, MODE_OPTIONS, PASSWORD_MIN_LENGTH } from '@/shared/protocol'
import { sendVerificationEmail } from './email'
import { parseMatchOptions } from './lobby'
import { newRoomCode } from './roomCode'

export { Room } from './room'
export { Lobby } from './lobby'
export { Accounts } from './accounts'

const CANONICAL_HOST = 'gomoku.recode.top'

function authError(error: string, status: number): Response {
  return Response.json({ error }, { status })
}

async function handleAuth(request: Request, env: Env, url: URL): Promise<Response> {
  const accounts = env.ACCOUNTS.get(env.ACCOUNTS.idFromName('accounts'))
  const action = url.pathname.slice('/api/auth/'.length)

  if (action === 'me' && request.method === 'GET') {
    const token = request.headers.get('Authorization')?.replace(/^Bearer /, '')
    const email = token ? await accounts.me(token) : null
    return email ? Response.json({ email }) : authError('unauthorized', 401)
  }
  if (request.method !== 'POST') return authError('not_found', 404)

  if (action === 'logout') {
    const token = request.headers.get('Authorization')?.replace(/^Bearer /, '')
    if (token) await accounts.logout(token)
    return new Response(null, { status: 204 })
  }

  const body = (await request.json().catch(() => null)) as Record<string, string> | null
  const email = body?.email?.trim().toLowerCase() ?? ''
  if (!EMAIL_PATTERN.test(email)) return authError('email_invalid', 400)

  if (action === 'register') {
    const result = await accounts.register(email)
    if (!result.ok) {
      return authError(result.error, result.error === 'cooldown' ? 429 : 409)
    }
    try {
      await sendVerificationEmail(env, email, result.code)
    } catch (err) {
      console.error(err)
      return authError('email_failed', 502)
    }
    return Response.json({ ok: true })
  }
  if (action === 'verify') {
    if ((body?.password ?? '').length < PASSWORD_MIN_LENGTH) {
      return authError('password_short', 400)
    }
    const result = await accounts.verify(email, body?.code ?? '', body!.password)
    if (!result.ok) return authError(result.error, 400)
    return Response.json({ token: result.token, email })
  }
  if (action === 'login') {
    const result = await accounts.login(email, body?.password ?? '')
    if (!result.ok) return authError(result.error, 401)
    return Response.json({ token: result.token, email })
  }
  return authError('not_found', 404)
}

async function handle(request: Request, env: Env, url: URL): Promise<Response> {
  if (url.pathname.startsWith('/api/auth/')) {
    return handleAuth(request, env, url)
  }
  if (url.pathname.startsWith('/api/')) {
    if (request.method === 'GET' && url.pathname === '/api/leaderboard') {
      const accounts = env.ACCOUNTS.get(env.ACCOUNTS.idFromName('accounts'))
      return Response.json(await accounts.leaderboard())
    }
    if (request.method === 'POST' && url.pathname === '/api/rooms') {
      const frame = Number(url.searchParams.get('frame') ?? FRAME_SECONDS)
      const mode = (url.searchParams.get('mode') ?? 'forbidden') as GameMode
      if (!FRAME_OPTIONS.includes(frame) || !MODE_OPTIONS.includes(mode)) {
        return new Response('Invalid options', { status: 400 })
      }
      const code = newRoomCode()
      await env.ROOM.get(env.ROOM.idFromName(code)).fetch(
        `https://room/create?frame=${frame}&mode=${mode}`,
        { method: 'POST' },
      )
      return Response.json({ code })
    }
    if (url.pathname === '/api/match/ws') {
      if (!parseMatchOptions(url.searchParams)) {
        return new Response('Invalid options', { status: 400 })
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