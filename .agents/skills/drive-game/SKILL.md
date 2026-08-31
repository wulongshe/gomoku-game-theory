---
name: drive-game
description: Launch the dev server and drive real games in headless Chromium (two players, moves, screenshots) to visually verify UI changes in this repo
---

# Drive a real game for visual verification

Use this when a change touches the board, animations, layout, or any flow that
vitest can't show. It launches Vite, drives one or two real browser sessions
with playwright-core, and produces screenshots you must actually look at.

Game rules, board geometry, and UI copy live in the code and change over time —
read them fresh each run instead of trusting remembered values:

- board constants (cell size, padding, grid size) and the board svg markup:
  `src/client/components/Board.vue`, `packages/engine/src/game.ts`
- move legality (opening restrictions, collisions, win/annihilation
  conditions): `packages/engine/src/game.ts`
- button/status text used for selectors: `src/client/views/*.vue`

## Setup (once per environment)

The browser binary is already cached globally; only `playwright-core` (~3MB) is
needed, installed in the session scratchpad — never in the project:

```bash
cd <scratchpad> && npm init -y && npm install playwright-core --no-fund --no-audit
```

Launch it against the cached Chromium:

```js
const { chromium } = require('playwright-core')
const browser = await chromium.launch({
  executablePath: require('os').homedir() + '/.cache/ms-playwright/chromium-<version>/chrome-linux64/chrome',
  args: ['--no-sandbox'],
})
```

`ls ~/.cache/ms-playwright/` for the current version directory.

Emoji do not render (boxes) unless a color-emoji font is installed:
`~/.local/share/fonts/NotoColorEmoji.ttf` + `fc-cache -f` fixes it.

## Dev server

The user often runs their own dev server on the default port (5173) — never
kill or reuse it. Start a dedicated instance on its own port and only ever
kill that port:

```bash
(pnpm dev --port 5199 --strictPort > <scratchpad>/dev.log 2>&1 &)
timeout 30 bash -c 'until curl -sf http://localhost:5199 >/dev/null; do sleep 1; done'
# ... drive against http://localhost:5199 ...
fuser -k 5199/tcp
```

`--strictPort` fails loudly instead of drifting to another port (which would
leave the browser silently hitting a different, possibly stale instance).
Kill by port, not by a saved pid — the pnpm wrapper pid leaves the vite
child alive. Always kill your own instance when done.

## Two players in one browser

Room seats are keyed by a localStorage token, so two tabs in one context would
steal each other's seat. Use two isolated contexts:

```js
const ctxA = await browser.newContext({ viewport: { width: 480, height: 900 }, deviceScaleFactor: 2 })
const ctxB = await browser.newContext({ viewport: { width: 480, height: 900 }, deviceScaleFactor: 2 })
const a = await ctxA.newPage()
await a.goto('http://localhost:5173')
// create a room on page A (button text: see Home.vue), wait for **/room/**,
// open the same URL on page B, then both pages click ready (see Room.vue)
```

## Clicking board points

Read the board component for its svg `aria-label`, cell unit `U`, padding
`PAD`, and grid size, then convert grid coordinates to page pixels through the
element's bounding box:

```js
const svg = a.locator('svg[aria-label=<from Board.vue>]')
const box = await svg.boundingBox()
const scale = box.width / SIZE            // SIZE per Board.vue
const px = (i) => (PAD + i * U) * scale
await a.mouse.click(box.x + px(x), box.y + px(y))
```

Clicks on illegal points are silently ignored — check the engine's
`isLegalChoice` for what is legal in the current frame before scripting a
sequence. A frame settles when both players submit; wait for the next
frame-counter text before continuing, and design multi-frame sequences
(collisions, wins, annihilations) from the current engine rules.

For timeout-settle scenarios, submit with one player only and wait with a
generous timeout (frame length + a few seconds of server alarm latency).

## Screenshots

Screenshot the element, not the page, and look at the result — a blank or
misplaced frame means the drive failed:

```js
await svg.screenshot({ path: 'board.png' })
```

Use `deviceScaleFactor: 4` (or 8 on small elements) when checking pixel-level
alignment. For measuring ink offsets, load the PNG into a canvas inside
`page.evaluate` and compute the colored-pixel bounding box.
