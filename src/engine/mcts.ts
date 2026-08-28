import {
  settleFrame,
  type FrameChoices,
  type GameState,
  type Point,
  type Seat,
} from './game'
import {
  analyzeBoard,
  DIFFICULTY_SETTINGS,
  evaluateState,
  MAX_THREAT_VALUE,
  sampleIndex,
  TERMINAL,
  type Difficulty,
} from './ai'

const EXPLORATION = 1.0
const MAX_ITERATIONS = 60_000
// 递归深度上限：常规下棋盘单调填满、深度天然有界，唯「双方同帧成五湮灭清子」会破坏单调，硬顶防爆栈。
const MAX_DEPTH = 300
// 非终局威胁差的量级上限（含多胜点重奖），保证多威胁不被对数归一挤到与单威胁齐平。
const HEURISTIC_LOG = Math.log1p(MAX_THREAT_VALUE)

// 归一化到 [-1,1]：终局 ±1；非终局按 |值| 对数映射到 ±0.95，全量级保留梯度（tanh 会在冲四以上饱和，弃用）。
function normalize(raw: number): number {
  if (raw >= TERMINAL / 2) return 1
  if (raw <= -TERMINAL / 2) return -1
  const mag = Math.min(1, Math.log1p(Math.abs(raw)) / HEURISTIC_LOG) * 0.95
  return raw < 0 ? -mag : mag
}

// 联合动作 (AI, 对手) 落到帧提交结构；AI 执哪一色由 seat 决定。
function joint(seat: Seat, ai: Point, opp: Point): FrameChoices {
  return seat === 'black' ? { black: ai, white: opp } : { black: opp, white: ai }
}

// 节点静态部分（两种策略共用）：双方候选、首展评估值、是否可再展开（两侧都有候选）。
interface Core {
  state: GameState
  aiMoves: Point[]
  oppMoves: Point[]
  value0: number
  expandable: boolean
}

function expand(state: GameState, seat: Seat, candidates: number): Core {
  if (state.phase !== 'playing') {
    return { state, aiMoves: [], oppMoves: [], value0: normalize(evaluateState(state, seat)), expandable: false }
  }
  const { aiMoves, oppMoves, threatSelf, threatOpp } = analyzeBoard(state, seat, candidates)
  return {
    state,
    aiMoves,
    oppMoves,
    value0: normalize(threatSelf - threatOpp),
    expandable: aiMoves.length > 0 && oppMoves.length > 0,
  }
}

// SM-MCTS：解耦 UCB 逐帧向前搜，anytime + 时间盒；节点策略按难度选 DUCT 或遗憾匹配。budgetMs 可覆盖难度默认值。
export function searchBestMove(
  state: GameState,
  seat: Seat,
  difficulty: Difficulty = 'normal',
  budgetMs?: number,
): Point | null {
  const settings = DIFFICULTY_SETTINGS[difficulty]
  const budget = budgetMs ?? settings.budgetMs
  return settings.policy === 'rm'
    ? rmSearch(state, seat, settings.candidates, budget)
    : ductSearch(state, seat, settings.candidates, settings.explore, budget)
}

// ---- 第四层：解耦 UCB（DUCT），双方各持候选与收益统计，子节点按「AI×对手」联合动作索引 ----

interface DuctNode extends Core {
  aiSum: number[]
  aiCnt: number[]
  oppSum: number[]
  oppCnt: number[]
  children: (DuctNode | undefined)[]
  visits: number
}

function ductSearch(
  state: GameState,
  seat: Seat,
  candidates: number,
  explore: number,
  budget: number,
): Point | null {
  function makeNode(s: GameState): DuctNode {
    const core = expand(s, seat, candidates)
    const size = core.expandable ? core.aiMoves.length * core.oppMoves.length : 0
    return {
      ...core,
      aiSum: new Array(core.aiMoves.length).fill(0),
      aiCnt: new Array(core.aiMoves.length).fill(0),
      oppSum: new Array(core.oppMoves.length).fill(0),
      oppCnt: new Array(core.oppMoves.length).fill(0),
      children: new Array(size),
      visits: 0,
    }
  }

  // AI 是最大化方：未探索动作优先，其余取 UCB 上界最大。
  function selectAi(node: DuctNode): number {
    const logN = Math.log(node.visits + 1)
    let best = 0
    let bestScore = -Infinity
    for (let i = 0; i < node.aiMoves.length; i++) {
      if (node.aiCnt[i] === 0) return i
      const score = node.aiSum[i] / node.aiCnt[i] + EXPLORATION * Math.sqrt(logN / node.aiCnt[i])
      if (score > bestScore) {
        bestScore = score
        best = i
      }
    }
    return best
  }

  // 对手是最小化方：未探索动作优先，其余取（AI 视角的）UCB 下界最小。
  function selectOpp(node: DuctNode): number {
    const logN = Math.log(node.visits + 1)
    let best = 0
    let bestScore = Infinity
    for (let j = 0; j < node.oppMoves.length; j++) {
      if (node.oppCnt[j] === 0) return j
      const score = node.oppSum[j] / node.oppCnt[j] - EXPLORATION * Math.sqrt(logN / node.oppCnt[j])
      if (score < bestScore) {
        bestScore = score
        best = j
      }
    }
    return best
  }

  function simulate(node: DuctNode, depth: number): number {
    if (!node.expandable || depth >= MAX_DEPTH) return node.value0
    const i = selectAi(node)
    const j = selectOpp(node)
    const idx = i * node.oppMoves.length + j
    let child = node.children[idx]
    let value: number
    if (!child) {
      child = makeNode(settleFrame(node.state, joint(seat, node.aiMoves[i], node.oppMoves[j])))
      node.children[idx] = child
      value = child.value0
    } else {
      value = simulate(child, depth + 1)
    }
    node.visits++
    node.aiSum[i] += value
    node.aiCnt[i]++
    node.oppSum[j] += value
    node.oppCnt[j]++
    return value
  }

  const root = makeNode(state)
  if (!root.expandable) return root.aiMoves[0] ?? null
  if (root.aiMoves.length === 1) return root.aiMoves[0]

  const deadline = performance.now() + budget
  let iterations = 0
  while (iterations < MAX_ITERATIONS && performance.now() < deadline) {
    simulate(root, 0)
    iterations++
  }

  const totalVisits = root.aiCnt.reduce((a, b) => a + b, 0)
  if (totalVisits === 0) return root.aiMoves[0]

  // 困难（explore=0）取访问最多手（最强）；其余在访问频率上混入均匀探索后采样（多样、不可预判）。
  if (explore === 0) {
    let best = 0
    for (let i = 1; i < root.aiCnt.length; i++) {
      if (root.aiCnt[i] > root.aiCnt[best]) best = i
    }
    return root.aiMoves[best]
  }

  const n = root.aiMoves.length
  const dist = root.aiCnt.map((c) => (1 - explore) * (c / totalVisits) + explore / n)
  return root.aiMoves[sampleIndex(dist)]
}

// ---- 第五层：遗憾匹配（RM），把每个节点当重复矩阵博弈求解，双方平均策略收敛混合纳什 ----

interface RmNode extends Core {
  regretAi: number[]
  regretOpp: number[]
  stratAi: number[]
  stratOpp: number[]
  qSum: number[]
  qCnt: number[]
  children: (RmNode | undefined)[]
  visits: number
}

// 遗憾匹配：正遗憾归一即为当前策略，全非正时退回均匀。
function regretMatch(regret: number[]): number[] {
  const n = regret.length
  let sum = 0
  for (const r of regret) if (r > 0) sum += r
  const out = new Array<number>(n)
  if (sum <= 0) return out.fill(1 / n)
  for (let k = 0; k < n; k++) out[k] = regret[k] > 0 ? regret[k] / sum : 0
  return out
}

// 每次迭代：双方按当前遗憾匹配策略各采一手向下走，回来用子节点均值 q（未采样对按父节点静态值兜底）
// 估两侧各动作价值并累加遗憾与平均策略。根节点按 AI 平均策略采样落子 —— 混合纳什、博弈最优、不可被针对。
function rmSearch(
  state: GameState,
  seat: Seat,
  candidates: number,
  budget: number,
): Point | null {
  function makeNode(s: GameState): RmNode {
    const core = expand(s, seat, candidates)
    const n = core.aiMoves.length
    const m = core.oppMoves.length
    const size = core.expandable ? n * m : 0
    return {
      ...core,
      regretAi: new Array(n).fill(0),
      regretOpp: new Array(m).fill(0),
      stratAi: new Array(n).fill(0),
      stratOpp: new Array(m).fill(0),
      qSum: new Array(size).fill(0),
      qCnt: new Array(size).fill(0),
      children: new Array(size),
      visits: 0,
    }
  }

  function simulate(node: RmNode, depth: number): number {
    if (!node.expandable || depth >= MAX_DEPTH) return node.value0
    const n = node.aiMoves.length
    const m = node.oppMoves.length
    const sigmaAi = regretMatch(node.regretAi)
    const sigmaOpp = regretMatch(node.regretOpp)
    const i = sampleIndex(sigmaAi)
    const j = sampleIndex(sigmaOpp)
    const idx = i * m + j

    let child = node.children[idx]
    let u: number
    if (!child) {
      child = makeNode(settleFrame(node.state, joint(seat, node.aiMoves[i], node.oppMoves[j])))
      node.children[idx] = child
      u = child.value0
    } else {
      u = simulate(child, depth + 1)
    }
    node.qSum[idx] += u
    node.qCnt[idx]++

    const vAi = new Array<number>(n)
    let baseline = 0
    for (let k = 0; k < n; k++) {
      const base = k * m
      let v = 0
      for (let l = 0; l < m; l++) {
        const c = node.qCnt[base + l]
        v += sigmaOpp[l] * (c > 0 ? node.qSum[base + l] / c : node.value0)
      }
      vAi[k] = v
      baseline += sigmaAi[k] * v
    }
    for (let k = 0; k < n; k++) {
      node.regretAi[k] += vAi[k] - baseline
      node.stratAi[k] += sigmaAi[k]
    }
    for (let l = 0; l < m; l++) {
      let v = 0
      for (let k = 0; k < n; k++) {
        const c = node.qCnt[k * m + l]
        v += sigmaAi[k] * (c > 0 ? node.qSum[k * m + l] / c : node.value0)
      }
      node.regretOpp[l] += baseline - v
      node.stratOpp[l] += sigmaOpp[l]
    }
    node.visits++
    return u
  }

  const root = makeNode(state)
  if (!root.expandable) return root.aiMoves[0] ?? null
  if (root.aiMoves.length === 1) return root.aiMoves[0]

  const deadline = performance.now() + budget
  let iterations = 0
  while (iterations < MAX_ITERATIONS && performance.now() < deadline) {
    simulate(root, 0)
    iterations++
  }

  const total = root.stratAi.reduce((a, b) => a + b, 0)
  if (total <= 0) return root.aiMoves[0]
  const dist = root.stratAi.map((s) => s / total)
  return root.aiMoves[sampleIndex(dist)]
}
