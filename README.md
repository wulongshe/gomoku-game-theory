# 博弈五子棋

下棋，更是读心 —— 经典五子棋 × 同时落子，每一手都是心理博弈。

**在线试玩：<https://gomoku.recode.top>**（免下载、免注册，10 秒开局）

## 玩法

与轮流落子的传统五子棋不同，双方在每回合限时内**各自秘密选点，同时落子**：

- **同时落子**：每回合限时 30 / 60 秒或不限时，双方都提交或时间到后同时揭晓。对方提交前仍可变更落点；超时未提交则本回合弃着。
- **撞子**：双方落在同一点时，按开局选择的模式处理——
  - 禁点模式：该点变为禁点，双方都无法再落子；
  - 负子模式：化作负子，双方连线经过它时都减 1。
- **胜负**：任意方向连续累计满 5 即胜（负子减 1）。双方同时连五则连线棋子一起消失，对局继续。
- **对抗性规则**：首回合只能落在中央 3×3 且禁天元；禁点 / 负子连成五整线清除，位置重新可用。

## 功能

- **双人联机**：建房间发链接开黑，或随机匹配。随机匹配固定禁点模式，时限可多选、按双方选项的交集撮合；局终可带新设置发起「再来一局」。
- **人机对战**：四档难度（简单 / 普通 / 困难 / 大师），AI 在 Web Worker 中搜索，不阻塞界面。
- **每日竞技场**：每晚 20:00–20:30（北京时间）开放，登录后报名，Elo 计分并进入排行榜；人数不足时由拟人 bot 补位。
- **邮箱登录**：仅竞技场与排行榜需要，验证码经 Resend 发送；其余功能游客可用。
- **分享海报**：生成带房间二维码的 SVG 海报，支持系统分享或保存图片。
- **小红书小程序**：`miniapp/` 下的 Taro 工程，仅人机对战、全程本地计算，见 [miniapp/README.md](miniapp/README.md)。

## 技术栈

- **前端**：Vue 3 + Tailwind CSS v4 + Vite
- **后端**：Cloudflare Workers + Durable Objects（WebSocket Hibernation + Alarms）
- **引擎**：纯函数 TypeScript 包 `@gomoku/engine`（规则 / 评估 / AI / MCTS），Web 与小程序共用
- **测试**：Vitest（引擎单元测试 + `@cloudflare/vitest-pool-workers` Worker 集成测试）

无数据库、无框架路由：房间、大厅、账号、竞技场各是一个 Durable Object，`ctx.storage` 即状态源。

## 目录结构

```
.
├── packages/
│   ├── engine/    # @gomoku/engine：棋规 game / 评估 eval / AI ai / 搜索 mcts
│   ├── branding/  # 产品名、标语等共享文案
│   └── config/    # AI 模式与难度选项
├── src/
│   ├── client/    # Vue 前端（首页、联机房间、人机房间、竞技场大厅）
│   ├── shared/    # 客户端与 Worker 共享的消息协议
│   └── worker/    # Worker 入口，Room / Lobby / Accounts / Tournament DO，邮件与 bot
├── miniapp/       # 小红书小程序（Taro + Vue 3）
├── scripts/       # AI 自对弈评测（pnpm ai:battle）
└── tests/
    ├── engine/    # 引擎与 AI 单元测试（node 环境）
    └── worker/    # Worker 集成测试（workerd 环境）
```

## 本地开发

```bash
pnpm install    # 仓库根执行，安装 workspace 全部成员
pnpm dev        # Vite + 本地 workerd，打开 http://localhost:5173
pnpm test       # 运行全部测试
pnpm check      # 类型检查
pnpm typegen    # 重新生成 worker-configuration.d.ts
pnpm ai:battle  # AI 自对弈评测（Node ≥ 23.6）
```

本地环境变量放在 `.dev.vars`（已忽略）：

| 变量 | 说明 |
|---|---|
| `RESEND_API_KEY` | 缺省时验证码打印到控制台，不发邮件 |
| `TOURNAMENT_WINDOW` | 竞技场时段，默认 `20:00-20:30` |

## 部署

```bash
pnpm deploy         # 生产：gomoku.recode.top
```
