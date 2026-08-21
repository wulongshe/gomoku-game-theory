import { DurableObject } from 'cloudflare:workers'

export class Room extends DurableObject<Env> {
  fetch(request: Request): Response {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 })
    }
    const pair = new WebSocketPair()
    this.ctx.acceptWebSocket(pair[1])
    return new Response(null, { status: 101, webSocket: pair[0] })
  }

  webSocketMessage(_ws: WebSocket, _message: string | ArrayBuffer): void {}

  webSocketClose(_ws: WebSocket, _code: number, _reason: string, _wasClean: boolean): void {}
}
