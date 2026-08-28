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

// 同时落子博弈树节点：双方各持候选与收益统计（解耦 UCB），子节点按「AI×对手」联合动作索引；value0 为首展静态/终局值。
interface Node {
  state: GameState
  aiMoves: Point[]
  oppMoves: Point[]
  aiSum: number[]
  aiCnt: number[]
  oppSum: number[]
  oppCnt: number[]
  children: (Node | undefined)[]
  visits: number
  value0: number
  expandable: boolean
}

// SM-MCTS：解耦 UCB 向前搜，anytime + 时间盒，到点从根访问频率采样落子；budgetMs 可覆盖难度默认值。
export function searchBestMove(
  state: GameState,
  seat: Seat,
  difficulty: Difficulty = 'normal',
  budgetMs?: number,
): Point | null {
  const settings = DIFFICULTY_SETTINGS[difficulty]
  const budget = budgetMs ?? settings.budgetMs
  const { candidates, explore } = settings

  function makeNode(s: GameState): Node {
    if (s.phase !== 'playing') {
      return {
        state: s,
        aiMoves: [],
        oppMoves: [],
        aiSum: [],
        aiCnt: [],
        oppSum: [],
        oppCnt: [],
        children: [],
        visits: 0,
        value0: normalize(evaluateState(s, seat)),
        expandable: false,
      }
    }
    const { aiMoves, oppMoves, threatSelf, threatOpp } = analyzeBoard(s, seat, candidates)
    const expandable = aiMoves.length > 0 && oppMoves.length > 0
    return {
      state: s,
      aiMoves,
      oppMoves,
      aiSum: new Array(aiMoves.length).fill(0),
      aiCnt: new Array(aiMoves.length).fill(0),
      oppSum: new Array(oppMoves.length).fill(0),
      oppCnt: new Array(oppMoves.length).fill(0),
      children: expandable ? new Array(aiMoves.length * oppMoves.length) : [],
      visits: 0,
      value0: normalize(threatSelf - threatOpp),
      expandable,
    }
  }

  function joint(node: Node, i: number, j: number): FrameChoices {
    const ai = node.aiMoves[i]
    const op = node.oppMoves[j]
    const choices: FrameChoices =
      seat === 'black' ? { black: ai, white: op } : { black: op, white: ai }
    if (ai.x === op.x && ai.y === op.y) choices.first = 'black'
    return choices
  }

  // AI 是最大化方：未探索动作优先，其余取 UCB 上界最大。
  function selectAi(node: Node): number {
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
  function selectOpp(node: Node): number {
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

  function simulate(node: Node, depth: number): number {
    if (!node.expandable || depth >= MAX_DEPTH) return node.value0
    const i = selectAi(node)
    const j = selectOpp(node)
    const idx = i * node.oppMoves.length + j
    let child = node.children[idx]
    let value: number
    if (!child) {
      child = makeNode(settleFrame(node.state, joint(node, i, j)))
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
