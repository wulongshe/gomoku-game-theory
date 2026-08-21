<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import type { GameState, Seat } from '@/engine/game'
import type { ServerMessage } from '@/shared/protocol'

const props = defineProps<{ code: string }>()

const roomUrl = location.href

type Stage = 'connecting' | 'waiting' | 'playing' | 'over' | 'error'

const stage = ref<Stage>('connecting')
const seat = ref<Seat | null>(null)
const game = ref<GameState | null>(null)
const deadline = ref<number | null>(null)
const notice = ref('')
const copyState = ref<'idle' | 'copied' | 'failed'>('idle')

let ws: WebSocket | undefined

onMounted(() => {
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
        notice.value = ''
        if (msg.state.phase !== 'playing') stage.value = 'over'
        break
      case 'opponent_submitted':
        notice.value = '对方已提交'
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

onUnmounted(() => ws?.close())

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

const RESULT_TEXT: Record<GameState['phase'], string> = {
  playing: '',
  p1_won: 'p1 获胜',
  p2_won: 'p2 获胜',
  draw: '和棋',
}
</script>

<template>
  <main class="flex min-h-dvh flex-col items-center justify-center gap-6 bg-stone-100 p-6">
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
      <p class="text-stone-600">你是 {{ seat }} · 第 {{ game?.frame }} 帧</p>
      <div
        class="flex aspect-square w-full max-w-md items-center justify-center rounded-lg border-2 border-dashed border-stone-400 text-stone-400"
      >
        棋盘占位
      </div>
      <p v-if="stage === 'over' && game" class="text-xl font-bold text-stone-800">
        {{ RESULT_TEXT[game.phase] }}
      </p>
      <p class="text-sm text-stone-500">{{ notice }}</p>
    </template>

    <template v-else>
      <p class="text-stone-600">无法加入房间 {{ props.code }}</p>
      <a class="text-stone-800 underline" href="/">返回首页</a>
    </template>
  </main>
</template>
