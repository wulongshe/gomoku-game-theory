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
  sampleIndex,
  TERMINAL,
  WIN_SCORE,
  type Difficulty,
} from './ai'

const EXPLORATION = 1.0
const MAX_ITERATIONS = 60_000
// 递归深度上限：常规下每帧棋盘单调填满、深度天然 ≤ 可填帧数，
// 唯有「双方同帧成五湮灭清子」会破坏单调，这里硬顶住避免病态深链爆栈。
const MAX_DEPTH = 300
// 非终局 threatScore 差的量级上限（best ≤ WIN_SCORE，再加 0.25×次强）。
const HEURISTIC_LOG = Math.log1p(WIN_SCORE * 1.25)

// 归一化到 [-1, 1]：终局 ±1；非终局按 |值| 的对数单调映射到 (-0.95, 0.95)，
// 全量级都保留梯度。tanh 会在冲四以上直接饱和到 ±1，把「双威胁」「已成五」拉平，故弃用。
function normalize(raw: number): number {
  if (raw >= TERMINAL / 2) return 1
  if (raw <= -TERMINAL / 2) return -1
  const mag = Math.min(1, Math.log1p(Math.abs(raw)) / HEURISTIC_LOG) * 0.95
  return raw < 0 ? -mag : mag
}

// 同时落子博弈树节点：双方各持一份候选与其收益统计（decoupled-UCB），
// 子节点按「AI 选点 × 对手选点」的联合动作索引。value0 为首次展开时的静态/终局值。
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

// SM-MCTS：解耦 UCB 逐帧向前搜索，anytime + 时间盒，到点即从根的访问频率采样落子。
// budgetMs 缺省用难度对应的时间盒，测试/调参可显式覆盖。
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
    // 终局节点无需候选，直接用终局值；进行中节点单遍扫描出候选与威胁差，静态值即威胁差归一。
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

  // 困难（explore=0）：取访问数最多的一手，最强且不再按频率误采次优；
  // 其余难度：在访问频率上混入均匀探索后采样，保留多样、不可预判。
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
