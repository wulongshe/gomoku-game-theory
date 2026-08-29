import { settleFrame, type GameState, type Point, type Seat } from '../game'
import { sampleIndex, winningPoints } from '../eval'
import { DEFAULT_BLOCK_RATE } from '../opponent'
import { expand, joint, MAX_DEPTH, MAX_ITERATIONS, type Core } from './core'

// 第五层：遗憾匹配（RM），把每个节点当重复矩阵博弈求解，双方平均策略收敛混合纳什。
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

// 一击得手概率达此阈值即兑现胜点（对应封堵率 ≤ 0.6 的对手）；稳堵者（含会针对你落点的 DUCT）退回纳什混合以免被针对。
const FINISH_THRESHOLD = 0.4

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
export function rmSearch(
  state: GameState,
  seat: Seat,
  candidates: number,
  budget: number,
  blockRate: number = DEFAULT_BLOCK_RATE,
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

  // 机会性终结：AI 有立即胜点时不照纳什「怕被撞」低概率出手。同时落子下对手只能靠抢占「我这手要下的那个点」
  // 阻止（撞点）；多个胜点并不提高单手命中率（只在后续帧留后备，其价值由搜索体现），故一击得手概率只取决于
  // 对手对该点的封堵率 blockRate：不常堵就兑现（惩罚放水），稳堵（会针对你唯一落点者，含 DUCT）则退回纳什混合、不被利用。
  const wins = winningPoints(state, seat)
  if (wins.length > 0) {
    // 抢点模式撞点仍按提交顺序五五归属，封堵只削一半成功率。
    const winProb = 1 - blockRate * (state.mode === 'race' ? 0.5 : 1)
    if (winProb >= FINISH_THRESHOLD) return wins[0]
  }

  const nashTotal = root.stratAi.reduce((a, b) => a + b, 0)
  if (nashTotal <= 0) return root.aiMoves[0]
  return root.aiMoves[sampleIndex(root.stratAi.map((s) => s / nashTotal))]
}
