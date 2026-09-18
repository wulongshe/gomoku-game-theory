# 博弈五子棋 · 小红书小程序（人机对战）

本目录是**独立的 Taro (Vue3) 工程**，与主仓库的 Web/Cloudflare 版并存，二者以 pnpm workspace 共享同一个引擎包 `@gomoku/engine`。

## 两套架构如何并存（pnpm monorepo）

```
gomoku-game-theory/          ← pnpm workspace 根
├─ packages/engine/          ← 引擎包 @gomoku/engine（棋规 game / 评估 eval / AI ai / 搜索 mcts）· 单一数据源
├─ src/{client,worker,shared}/   ← Web SPA + Cloudflare Workers/DO（联机 + 邮箱登录 + 排行榜）
└─ miniapp/                  ← 小红书小程序（仅人机对战，无联机 / 无登录 / 无分享）
```

- 引擎抽成 workspace 包 `@gomoku/engine`（`exports` 直出 `.ts` 源、零构建）；Web 与 miniapp 都以 `@gomoku/engine/*` 依赖它，不复制、不分叉。
- pnpm workspace 下**各包 `node_modules` 相互隔离**，miniapp 的 Taro（Vite 5）与 Web 的 Vite 7 / Cloudflare 互不干扰。
- 改引擎（`packages/engine`）即同时影响两端；改 UI 各自独立。根 `.gitignore` 已忽略任意层级的 `node_modules/`、`dist/`。

## 与 Web 版的取舍

| | Web 版（`src/`） | 小程序（`miniapp/`） |
|---|---|---|
| 人机对战 | ✅ | ✅ |
| 双人联机 / 房间 / 匹配 | ✅ | ❌ 砍掉 |
| 邮箱登录 / 排行榜 | ✅ | ❌ 砍掉 |
| 分享海报 / 邀请 | ✅ | ❌ 砍掉 |
| 网络请求 | WebSocket + fetch | **无**（全程本地计算） |
| AI 运行 | Web Worker | 主线程（见「后续」） |
| 棋盘渲染 | SVG | View 布局 |

因为**没有任何网络请求**，小程序侧不需要服务器域名 ICP 备案，也不需要合法域名白名单。

## 本地开发

> 首次需拉取 Taro 依赖（体积较大）。本仓库是 pnpm workspace，在**仓库根**执行一次安装即可打通所有包并链接 `@gomoku/engine`：

```bash
pnpm install                 # 在仓库根执行（安装 workspace 全部成员）
cd miniapp && pnpm dev   # = taro build --type xhs --watch，产物在 miniapp/dist
```

用**小红书开发者工具**打开 `miniapp/dist` 目录预览、真机调试。小程序 AppID 与基础库版本填在根目录的 `project.xhs.json`（`appid` 现为占位 `touristappid`，`libVersion` 需 ≥ 3.102.3）。

生产构建：

```bash
pnpm build
```

类型检查（可选，装好依赖后）：`pnpm check`。

## 当前范围与后续

已实现（MVP）：完整人机对局（同时落子、撞子成禁点、五连/同五两消/和棋判定）、难度（简单/普通/困难/地狱）、地狱难度「棋力」滑条（5%~100%，连续读心置信度 `read = 棋力 - 0.05`，与 Web 版同引擎）、本地续局。

后续可加：
- **AI 搜索移出主线程**——地狱难度时间盒较长，主线程搜索会短暂卡顿；确认小红书支持 `Taro.createWorker` 后迁至 worker（`src/game/ai.ts` 已抽象，替换成本低）。
- 配置弹窗、回合计时、落子/消子动画、规则弹窗。
