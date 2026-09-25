import { customAlphabet } from 'nanoid'
import { ROOM_CODE_LENGTHS } from '@/shared/protocol'

const generators = ROOM_CODE_LENGTHS.map((length) => customAlphabet('0123456789', length))
const ATTEMPTS_PER_LENGTH = 6

// 分配一个未占用的纯数字房号并建房：逐个候选码尝试原子创建，撞车（409）就重试；
// 同一长度连撞满 ATTEMPTS_PER_LENGTH 次（房间多）才升到更长，从而优先保留好记的 4 位短号。
// 匹配房（matched）帧时长按回合数渐增，不取 frame。
export async function allocateRoom(
  rooms: Env["ROOM"] | Env["MELEE"],
  opts: { frame?: number; ai?: boolean; matched?: boolean; players?: number },
): Promise<string> {
  for (const generate of generators) {
    for (let attempt = 0; attempt < ATTEMPTS_PER_LENGTH; attempt++) {
      const code = generate()
      const params = new URLSearchParams()
      if (opts.frame !== undefined) params.set('frame', String(opts.frame))
      if (opts.players !== undefined) params.set('players', String(opts.players))
      if (opts.matched) params.set('matched', '1')
      if (opts.ai) params.set('ai', '1')
      const created = await rooms.get(rooms.idFromName(code)).fetch(
        `https://room/create?${params}`,
        { method: 'POST' },
      )
      if (created.ok) return code
    }
  }
  throw new Error('failed to allocate a room code')
}
