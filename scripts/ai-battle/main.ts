// 由 Node 原生运行 TypeScript（Node ≥ 23.6，--import 加载 loader.ts 为相对导入补 .ts）：pnpm ai:battle
import { Worker } from 'node:worker_threads'
import { createGame, settleFrame, type GameMode, type GameState, type Point, type Seat } from '../../src/engine/game'
import { type SideConfig } from './search'

// ===== 修改这里的参数 =====
const MODE: GameMode = 'forbidden' // 撞子规则：forbidden 禁点 / race 竞速 / minus 负子
const ROUNDS = 20
const PARALLEL_ROUNDS = 4 // 并行对局数，每局占 2 个线程；8 核可开到 4
const MAX_FRAMES = 300 // 单局帧数上限，超限判平（防异常对局死循环）
// 每方独立指定核心搜索算法（绕过难度预设，便于同预算公平对比）：
const BLACK: SideConfig = { policy: 'rm', candidates: 7, budgetMs: 1200 }
const WHITE: SideConfig = { policy: 'duct', candidates: 7, explore: 0, budgetMs: 800 }
// ==========================

interface MatchConfig {
  mode: GameMode
  black: SideConfig
  white: SideConfig
  rounds: number
  parallel: number
  maxFrames: number
}

interface MatchSummary {
  blackWins: number
  whiteWins: number
  draws: number
}

type MatchOutcome = 'black' | 'white' | 'draw'

// 每帧结算后的进度回调（frame 为本局已结算的帧号），展示由调用方负责，playSingleGame 保持纯函数。
type FrameObserver = (frame: number, black: Point | null, white: Point | null) => void

type SearchFn = (state: GameState, seat: Seat, side: SideConfig) => Promise<Point | null>

interface WorkerPool {
  search: SearchFn
  close: () => void
}

interface SearchResponse {
  id: number
  result: Point | null
}

// 2 × 并行局数 个通用 Worker 轮询承接每次独立搜索：单局墙钟约两方预算的较大值，多局并行叠加。
function createWorkerPool(workerFile: URL, size: number, handler: { module: string; fn: string }): WorkerPool {
  const workers = Array.from({ length: size }, () => new Worker(workerFile, { workerData: handler }))
  const pending = new Map<number, (move: Point | null) => void>()
  let nextId = 0
  let turn = 0
  for (const worker of workers) {
    worker.on('message', ({ id, result }: SearchResponse) => {
      const resolve = pending.get(id)
      pending.delete(id)
      resolve?.(result)
    })
    worker.on('error', (error) => {
      console.error(`搜索 Worker 出错：${error.message}`)
      process.exit(1)
    })
  }
  return {
    search(state, seat, side) {
      return new Promise((resolve) => {
        const id = nextId++
        pending.set(id, resolve)
        workers[turn++ % workers.length].postMessage({ id, args: [state, seat, side] })
      })
    },
    close() {
      for (const worker of workers) void worker.terminate()
    },
  }
}

// 搜索只读 board/frame/mode/phase，快照一份防御性拷贝，避免搜索路径意外改动对局状态。
function snapshotState(state: GameState): GameState {
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

function outcomeFromPhase(phase: GameState['phase']): MatchOutcome {
  if (phase === 'black_won') return 'black'
  if (phase === 'white_won') return 'white'
  return 'draw'
}

function emptySummary(): MatchSummary {
  return { blackWins: 0, whiteWins: 0, draws: 0 }
}

function recordOutcome(summary: MatchSummary, outcome: MatchOutcome): MatchSummary {
  if (outcome === 'black') return { ...summary, blackWins: summary.blackWins + 1 }
  if (outcome === 'white') return { ...summary, whiteWins: summary.whiteWins + 1 }
  return { ...summary, draws: summary.draws + 1 }
}

// race 模式撞点时先手掷硬币归属（与引擎评估的两种先手各半口径一致）；其余模式不需要 first。
function frameChoices(
  mode: GameMode,
  black: Point | null,
  white: Point | null,
): { black: Point | null; white: Point | null; first?: Seat } {
  const collided = black !== null && white !== null && black.x === white.x && black.y === white.y
  if (mode === 'race' && collided) {
    return { black, white, first: Math.random() < 0.5 ? 'black' : 'white' }
  }
  return { black, white }
}

async function playSingleGame(
  config: MatchConfig,
  search: SearchFn,
  onFrame?: FrameObserver,
): Promise<MatchOutcome> {
  let state = createGame(config.mode)
  while (state.phase === 'playing' && state.frame <= config.maxFrames) {
    const view = snapshotState(state)
    const [black, white] = await Promise.all([
      search(view, 'black', config.black),
      search(view, 'white', config.white),
    ])
    if (!black && !white) return 'draw' // 双方都无合法手，判平
    const frame = state.frame
    state = settleFrame(state, frameChoices(config.mode, black, white))
    onFrame?.(frame, black, white)
  }
  return outcomeFromPhase(state.phase) // 帧数超限仍未分胜负 → draw
}

function formatOutcome(outcome: MatchOutcome): string {
  if (outcome === 'black') return '黑胜'
  if (outcome === 'white') return '白胜'
  return '平局'
}

function formatMove(point: Point | null): string {
  return point ? `(${point.x},${point.y})` : '—'
}

function formatSide(side: SideConfig): string {
  if (side.policy === 'rm') return `rm(候选${side.candidates}·${side.budgetMs}ms)`
  return `duct(候选${side.candidates}·探索${side.explore}·${side.budgetMs}ms)`
}

function formatSummaryLine(summary: MatchSummary, config: MatchConfig): string {
  return `累计 黑方 ${formatSide(config.black)}：${summary.blackWins}胜 ${summary.whiteWins}负 ${summary.draws}平；白方 ${formatSide(config.white)}：${summary.whiteWins}胜 ${summary.blackWins}负 ${summary.draws}平`
}

async function runSeries(config: MatchConfig, search: SearchFn): Promise<MatchSummary> {
  let summary = emptySummary()
  let nextRound = 1

  async function playRound(i: number): Promise<void> {
    const prefix = `[${i}/${config.rounds}] `
    const startedAt = performance.now()
    process.stdout.write(`${prefix}开局：黑 ${formatSide(config.black)} vs 白 ${formatSide(config.white)}（模式 ${config.mode}）\n`)
    const outcome = await playSingleGame(config, search, (frame, black, white) => {
      const collided = black !== null && white !== null && black.x === white.x && black.y === white.y
      process.stdout.write(
        `${prefix}帧 ${String(frame).padStart(3, ' ')}：黑 ${formatMove(black)}，白 ${formatMove(white)}${collided ? '  ⚡撞点' : ''}\n`,
      )
    })
    const seconds = ((performance.now() - startedAt) / 1000).toFixed(1)
    summary = recordOutcome(summary, outcome)
    process.stdout.write(`${prefix}本局 ${formatOutcome(outcome)}（用时 ${seconds}s）｜${formatSummaryLine(summary, config)}\n`)
  }

  // 每个并发槽循环领下一局，保持所有槽位始终忙碌。
  async function takeRounds(): Promise<void> {
    while (nextRound <= config.rounds) {
      const i = nextRound++
      await playRound(i)
    }
  }

  await Promise.all(Array.from({ length: config.parallel }, () => takeRounds()))
  return summary
}

function formatPercent(count: number, total: number): string {
  if (total === 0) return '0.0%'
  return `${((count / total) * 100).toFixed(1)}%`
}

function printSummary(config: MatchConfig, summary: MatchSummary, elapsedMs: number): void {
  const total = config.rounds
  process.stdout.write(
    `\n对战完成\n模式：${config.mode}\n黑方：${formatSide(config.black)}，胜 ${summary.blackWins}，负 ${summary.whiteWins}，平 ${summary.draws}\n白方：${formatSide(config.white)}，胜 ${summary.whiteWins}，负 ${summary.blackWins}，平 ${summary.draws}\n黑方胜率：${formatPercent(summary.blackWins, total)}，白方胜率：${formatPercent(summary.whiteWins, total)}，平局率：${formatPercent(summary.draws, total)}\n总用时：${(elapsedMs / 1000).toFixed(1)}s\n`,
  )
}

async function main(): Promise<void> {
  const config: MatchConfig = {
    mode: MODE,
    black: BLACK,
    white: WHITE,
    rounds: ROUNDS,
    parallel: PARALLEL_ROUNDS,
    maxFrames: MAX_FRAMES,
  }

  process.stdout.write(
    `开始测试：模式 ${config.mode}，黑方 ${formatSide(config.black)}，白方 ${formatSide(config.white)}，轮数 ${config.rounds}，并行 ${config.parallel} 局，单局帧数上限 ${config.maxFrames}\n`,
  )
  const pool = createWorkerPool(
    new URL('../worker.ts', import.meta.url),
    config.parallel * 2,
    { module: new URL('./search', import.meta.url).href, fn: 'searchSideMove' },
  )
  const startedAt = performance.now()
  try {
    const summary = await runSeries(config, pool.search)
    printSummary(config, summary, performance.now() - startedAt)
  } finally {
    pool.close()
  }
}

void main()
