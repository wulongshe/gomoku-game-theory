<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import Board from '../components/Board.vue'
import { isLegalChoice, type GameState, type Point, type Seat } from '@/engine/game'
import type { ClientMessage, ServerMessage } from '@/shared/protocol'

const props = defineProps<{ code: string }>()

const roomUrl = location.href

type Stage = 'connecting' | 'waiting' | 'playing' | 'over' | 'error'

const stage = ref<Stage>('connecting')
const seat = ref<Seat>('p1')
const game = ref<GameState | null>(null)
const deadline = ref<number | null>(null)
const selected = ref<Point | null>(null)
const submitted = ref(false)
const oppSubmitted = ref(false)
const notice = ref('')
const copyState = ref<'idle' | 'copied' | 'failed'>('idle')
const now = ref(Date.now())

let ws: WebSocket | undefined
let ticker: ReturnType<typeof setInterval> | undefined

onMounted(() => {
  ticker = setInterval(() => (now.value = Date.now()), 250)
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  ws = new WebSocket(`${proto}://${location.host}/api/rooms/${props.code}/ws`)
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data as string) as ServerMessage
    switch (msg.type) {
      case 'joined':
        seat.value = msg.seat
        stage.value = 'waiting'
        break
      case 'start':
        game.value = msg.state
        deadline.value = msg.deadline
        stage.value = 'playing'
        break
      case 'frame_settled':
        game.value = msg.state
        deadline.value = msg.deadline
        selected.value = null
        submitted.value = false
        oppSubmitted.value = false
        notice.value = ''
        if (msg.state.phase !== 'playing') stage.value = 'over'
        break
      case 'opponent_submitted':
        oppSubmitted.value = true
        break
      case 'opponent_left':
        notice.value = '对方已离开'
        break
      case 'error':
        notice.value = msg.message
        break
    }
  })
  ws.addEventListener('close', () => {
    if (stage.value !== 'over') stage.value = 'error'
  })
})

onUnmounted(() => {
  clearInterval(ticker)
  ws?.close()
})

const secondsLeft = computed(() =>
  deadline.value === null ? null : Math.max(0, Math.ceil((deadline.value - now.value) / 1000)),
)

const seatLabel = computed(() => (seat.value === 'p1' ? '你执黑' : '你执白'))

const resultText = computed(() => {
  if (!game.value) return ''
  if (game.value.phase === 'draw') return '和棋'
  const won = (game.value.phase === 'p1_won') === (seat.value === 'p1')
  return won ? '你赢了!' : '你输了'
})

function select(point: Point) {
  if (stage.value !== 'playing' || submitted.value || !game.value) return
  if (!isLegalChoice(game.value, point)) return
  selected.value = point
}

function submitChoice() {
  if (!ws || !game.value || !selected.value || submitted.value) return
  const msg: ClientMessage = { type: 'submit', frame: game.value.frame, point: selected.value }
  ws.send(JSON.stringify(msg))
  submitted.value = true
}

function fallbackCopy(text: string): boolean {
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()
  textarea.setSelectionRange(0, text.length)
  let ok = false
  try {
    ok = document.execCommand('copy')
  } catch {}
  textarea.remove()
  return ok
}

async function copyLink() {
  const url = location.href
  let ok = false
  if (window.isSecureContext && navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(url)
      ok = true
    } catch {}
  }
  if (!ok) ok = fallbackCopy(url)
  copyState.value = ok ? 'copied' : 'failed'
}
</script>

<template>
  <main class="flex min-h-dvh flex-col items-center justify-center gap-4 bg-stone-100 p-4">
    <template v-if="stage === 'connecting'">
      <p class="text-stone-600">正在连接房间 {{ props.code }}…</p>
    </template>

    <template v-else-if="stage === 'waiting'">
      <h1 class="text-2xl font-bold text-stone-800">房间 {{ props.code }}</h1>
      <p class="text-stone-600">把链接发给对方,对方打开即可开始</p>
      <button
        class="rounded-lg bg-stone-800 px-6 py-3 text-lg text-white active:bg-stone-600"
        @click="copyLink"
      >
        {{ copyState === 'copied' ? '已复制 ✓' : '复制链接' }}
      </button>
      <p v-if="copyState === 'failed'" class="text-sm text-stone-600">
        复制失败,请长按选中下方链接复制:
      </p>
      <p class="max-w-full break-all rounded bg-stone-200 px-3 py-2 text-sm text-stone-700 select-all">
        {{ roomUrl }}
      </p>
      <p class="text-sm text-stone-500">等待对方加入…</p>
    </template>

    <template v-else-if="stage === 'playing' || stage === 'over'">
      <div class="flex w-full max-w-md items-center justify-between text-sm text-stone-600">
        <span>{{ seatLabel }}</span>
        <span>第 {{ game?.frame }} 帧</span>
        <span
          v-if="secondsLeft !== null"
          class="tabular-nums"
          :class="secondsLeft <= 5 ? 'font-bold text-red-600' : ''"
        >
          {{ secondsLeft }}s
        </span>
      </div>

      <Board
        v-if="game"
        :state="game"
        :seat="seat"
        :selected="selected"
        :interactive="stage === 'playing' && !submitted"
        @select="select"
      />

      <template v-if="stage === 'playing'">
        <button
          class="w-full max-w-md rounded-lg bg-stone-800 px-6 py-3 text-lg text-white active:bg-stone-600 disabled:opacity-50"
          :disabled="!selected || submitted"
          @click="submitChoice"
        >
          {{ submitted ? '已提交,等待对方' : selected ? '确认提交' : '请选择落点' }}
        </button>
        <p class="min-h-5 text-sm text-stone-500">
          <span v-if="oppSubmitted">对方已提交 · </span>{{ notice }}
        </p>
      </template>

      <template v-else>
        <p class="text-xl font-bold text-stone-800">{{ resultText }}</p>
        <a class="text-stone-800 underline" href="/">返回首页</a>
      </template>
    </template>

    <template v-else>
      <p class="text-stone-600">无法加入房间 {{ props.code }}</p>
      <a class="text-stone-800 underline" href="/">返回首页</a>
    </template>
  </main>
</template>
