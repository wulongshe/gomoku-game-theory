import { onScopeDispose, ref } from 'vue'
import { chooseAiMove, type Difficulty } from '@/engine/ai'
import type { GameState, Point, Seat } from '@/engine/game'

// 只带上引擎选点真正会读到的字段，得到一个纯数据快照，可结构化克隆传给 Worker，
// 避免直接克隆 Vue 响应式代理（会抛 could not be cloned），也省去无关字段的拷贝。
function snapshot(state: GameState): GameState {
  return {
    board: [...state.board],
    phase: state.phase,
    frame: state.frame,
    mode: state.mode,
    cleared: [],
    lastMoves: [],
    winningLines: [],
  }
}

interface WorkerResponse {
  id: number
  move: Point | null
}

interface Pending {
  resolve: (move: Point | null) => void
  state: GameState
  seat: Seat
  difficulty: Difficulty
  opponentRationality: number
}

// 后台 AI 对手：把 SM-MCTS 放进 Web Worker，本帧一开始就与人同时思考，
// 结算时结果通常已备好，人零等待；无 Worker 环境退回主线程启发式（第三层）兜底。
export function useAiOpponent() {
  const thinking = ref(false)
  let worker: Worker | null = null
  let supported = typeof Worker !== 'undefined'
  let seq = 0
  const pending = new Map<number, Pending>()

  function ensureWorker() {
    if (worker || !supported) return
    try {
      worker = new Worker(new URL('../workers/ai.worker.ts', import.meta.url), { type: 'module' })
      worker.onmessage = ({ data }: MessageEvent<WorkerResponse>) => {
        const entry = pending.get(data.id)
        if (!entry) return
        pending.delete(data.id)
        entry.resolve(data.move)
      }
      worker.onerror = () => {
        supported = false
        worker?.terminate()
        worker = null
        for (const entry of pending.values()) {
          entry.resolve(chooseAiMove(entry.state, entry.seat, entry.difficulty, entry.opponentRationality))
        }
        pending.clear()
      }
    } catch {
      supported = false
      worker = null
    }
  }

  function request(
    state: GameState,
    seat: Seat,
    difficulty: Difficulty,
    opponentRationality = 1,
  ): Promise<Point | null> {
    ensureWorker()
    const id = ++seq
    thinking.value = true
    const done = (move: Point | null) => {
      if (id === seq) thinking.value = false
      return move
    }
    if (!worker) {
      return Promise.resolve(chooseAiMove(state, seat, difficulty, opponentRationality)).then(done)
    }
    return new Promise<Point | null>((resolve) => {
      pending.set(id, { resolve, state, seat, difficulty, opponentRationality })
      worker!.postMessage({ id, state: snapshot(state), seat, difficulty, opponentRationality })
    }).then(done)
  }

  onScopeDispose(() => {
    pending.clear()
    worker?.terminate()
    worker = null
  })

  return { thinking, request }
}
