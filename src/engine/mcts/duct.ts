import { settleFrame, type GameState, type Point, type Seat } from '../game'
import { sampleIndex } from '../eval'
import { expand, joint, MAX_DEPTH, MAX_ITERATIONS, type Core } from './core'

const EXPLORATION = 1.0

// 第四层：解耦 UCB（DUCT），双方各持候选与收益统计，子节点按「AI×对手」联合动作索引。
interface DuctNode extends Core {
  aiSum: number[]
  aiCnt: number[]
  oppSum: number[]
  oppCnt: number[]
  children: (DuctNode | undefined)[]
  visits: number
}

// rootOpp 非空时把根节点的对手候选固定为该点：AI 在此对手手下逐候选求最优应手，根以下仍常规同时落子搜索。
export function ductSearch(
  state: GameState,
  seat: Seat,
  candidates: number,
  explore: number,
  budget: number,
  rootOpp: Point | null = null,
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
  if (rootOpp) {
    root.oppMoves = [rootOpp]
    root.oppSum = [0]
    root.oppCnt = [0]
    root.children = new Array(root.aiMoves.length)
    root.expandable = root.aiMoves.length > 0
  }
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
