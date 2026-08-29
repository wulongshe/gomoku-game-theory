# 博弈五子棋

下棋，更是读心 —— 经典五子棋 × 同时落子，每一手都是心理博弈。

**在线试玩：<https://gomoku.recode.top>**（免下载、免注册，10 秒开局）

## 玩法

与轮流落子的传统五子棋不同，双方在每回合限时内**各自秘密选点，同时落子**：

- **同时落子**：每回合限时 30/60/120 秒或不限时，双方都提交或时间到后同时揭晓。对方提交前仍可变更落点；超时未提交则本回合弃着。
- **撞子**：双方落在同一点时，按开局选择的模式处理——
  - 禁点模式：该点变为禁点，双方都无法再落子；
  - 负子模式：化作负子，双方连线时都减 1；
  - 抢点模式：先提交的一方得到该点。
- **胜负**：任意方向连续累计满 5 即胜（负子减 1）。双方同时连五则连线棋子一起消失，对局继续。
- **对抗性规则**：首回合只能落在中央 3×3 且禁天元；禁点连成五整线清除，位置重新可用。

支持建房间发链接开黑，或随机匹配：时限和模式均可多选，按双方选项的交集撮合。局终还能带新设置发起「再来一局」。

## 技术栈

- **前端**：Vue 3 + Tailwind CSS v4 + Vite
- **后端**：Cloudflare Workers + Durable Objects（WebSocket Hibernation + Alarms）
- **测试**：Vitest（纯函数引擎测试 + `@cloudflare/vitest-pool-workers` Worker 集成测试）

无数据库、无框架路由：每个房间是一个 Durable Object，`ctx.storage` 即状态源；随机匹配由单例 Lobby DO 撮合。

## 目录结构

```
.
├── src/
│   ├── client/    # Vue 前端（首页、对战房间、棋盘组件）
│   ├── engine/    # 纯函数游戏引擎（棋盘、落子合法性、结算、消除）
│   ├── shared/    # 客户端与 Worker 共享的消息协议
│   └── worker/    # Cloudflare Worker 入口、Room / Lobby Durable Object
├── tests/
│   ├── engine/    # 引擎单元测试（node 环境）
│   └── worker/    # Worker 集成测试（workerd 环境）
```

## 本地开发

```bash
pnpm install
pnpm dev        # Vite + 本地 workerd，打开 http://localhost:5173
pnpm test       # 运行全部测试
pnpm check      # 类型检查
pnpm deploy     # 构建并部署到 Cloudflare
```
