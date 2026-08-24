<script setup lang="ts">
import { computed, ref } from 'vue'
import { useClipboard, useStorage, useTimestamp, useWebSocket } from '@vueuse/core'
import { nanoid } from 'nanoid'
import AppButton from '~/components/AppButton.vue'
import Board from '~/components/Board.vue'
import { roomWsUrl } from '~/api'
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
const rematchAsked = ref(false)
const notice = ref('')

const token = useStorage(`room-token:${props.code}`, nanoid(), sessionStorage)
const now = useTimestamp({ interval: 250 })
const { copy, copied, isSupported: copySupported } = useClipboard({ legacy: true })

let replaced = false
const { send } = useWebSocket(roomWsUrl(props.code, token.value), {
    autoReconnect: {
      retries: (retried) => retried < 5 && !replaced,
      delay: 1000,
      onFailed() {
        stage.value = 'error'
      },
    },
    onMessage(_ws, event) {
      handleMessage(JSON.parse(event.data as string) as ServerMessage)
    },
    onDisconnected(_ws, event) {
      if (event.reason === 'replaced by reconnect') replaced = true
      if (stage.value === 'over') return
      stage.value = replaced ? 'error' : 'connecting'
    },
})

function handleMessage(msg: ServerMessage) {
  switch (msg.type) {
    case 'joined':
      seat.value = msg.seat
      stage.value = 'waiting'
      break
    case 'start':
      game.value = msg.state
      deadline.value = msg.deadline
      submitted.value = msg.submitted[seat.value]
      oppSubmitted.value = msg.submitted[seat.value === 'p1' ? 'p2' : 'p1']
      selected.value = msg.yourChoice
      rematchAsked.value = false
      notice.value = ''
      stage.value = msg.state.phase === 'playing' ? 'playing' : 'over'
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
    case 'opponent_returned':
      notice.value = ''
      break
    case 'rematch_requested':
      notice.value = '对方想再来一局'
      break
    case 'error':
      notice.value = msg.message
      break
  }
}

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

function sendChoice(point: Point, final: boolean) {
  if (!game.value) return
  const msg: ClientMessage = { type: 'submit', frame: game.value.frame, point, final }
  send(JSON.stringify(msg))
}

function select(point: Point) {
  if (stage.value !== 'playing' || submitted.value || !game.value) return
  if (!isLegalChoice(game.value, point)) return
  selected.value = point
  sendChoice(point, false)
}

function reload() {
  location.reload()
}

function submitChoice() {
  if (!game.value || !selected.value || submitted.value) return
  sendChoice(selected.value, true)
  submitted.value = true
}

function requestRematch() {
  if (rematchAsked.value) return
  send(JSON.stringify({ type: 'rematch' } satisfies ClientMessage))
  rematchAsked.value = true
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
      <AppButton v-if="copySupported" @click="copy(roomUrl)">
        {{ copied ? '已复制 ✓' : '复制链接' }}
      </AppButton>
      <p v-else class="text-sm text-stone-600">请长按选中下方链接复制:</p>
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
        <AppButton class="w-full max-w-md" :disabled="!selected || submitted" @click="submitChoice">
          {{ submitted ? '已提交,等待对方' : selected ? '确认提交' : '请选择落点' }}
        </AppButton>
        <p class="min-h-5 text-sm text-stone-500">
          <span v-if="oppSubmitted">对方已提交 · </span>{{ notice }}
        </p>
        <p v-if="selected && !submitted" class="text-xs text-stone-400">
          未确认时,帧末将自动提交已选落点
        </p>
      </template>

      <template v-else>
        <p class="text-xl font-bold text-stone-800">{{ resultText }}</p>
        <AppButton class="w-full max-w-md" :disabled="rematchAsked" @click="requestRematch">
          {{ rematchAsked ? '等待对方…' : '再来一局' }}
        </AppButton>
        <p class="min-h-5 text-sm text-stone-500">{{ notice }}</p>
        <a class="text-stone-800 underline" href="/">返回首页</a>
      </template>
    </template>

    <template v-else>
      <template v-if="game">
        <p class="text-stone-600">连接已断开</p>
        <AppButton @click="reload">重新连接</AppButton>
      </template>
      <template v-else>
        <p class="text-stone-600">无法加入房间 {{ props.code }}</p>
        <a class="text-stone-800 underline" href="/">返回首页</a>
      </template>
    </template>
  </main>
</template>
