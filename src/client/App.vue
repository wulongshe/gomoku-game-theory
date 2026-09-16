<script setup lang="ts">
import AiRoom from './views/AiRoom.vue'
import ChallengeRoom from './views/ChallengeRoom.vue'
import Home from './views/Home.vue'
import Room from './views/Room.vue'
import TournamentLobby from './views/TournamentLobby.vue'

const code = location.pathname.match(/^\/room\/(\d{4,8})$/)?.[1] ?? null
const ai = location.pathname === '/ai'
const tournament = location.pathname === '/tournament'
const challenge = location.pathname === '/challenge'
</script>

<template>
  <Room v-if="code" :code="code" />
  <AiRoom v-else-if="ai" />
  <TournamentLobby v-else-if="tournament" />
  <ChallengeRoom v-else-if="challenge" />
  <Home v-else />
</template>
