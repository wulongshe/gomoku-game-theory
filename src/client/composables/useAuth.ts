import { computed, ref } from 'vue'
import { useStorage } from '@vueuse/core'
import {
  authLogout,
  authMe,
  authSetEmailVisible,
  type AuthSession,
  type EmailVisibility,
} from '~/apis'
import { useAuthToken } from '~/composables/useAuthToken'
import { ROOM_KEY_PREFIX } from '~/constants/storage'

const token = useAuthToken()
const email = useStorage('auth-email', '')
const emailVisibility = ref<EmailVisibility>({ leaderboard: false, game: false })

export function useAuth() {
  const loggedIn = computed(() => Boolean(token.value))

  function setSession(session: AuthSession) {
    token.value = session.token
    email.value = session.email
    emailVisibility.value = { leaderboard: false, game: false }
  }

  async function refresh() {
    if (!token.value) return
    try {
      const profile = await authMe()
      if (profile === null) {
        token.value = ''
        email.value = ''
      } else {
        email.value = profile.email
        emailVisibility.value = profile.emailVisibility
      }
    } catch {}
  }

  async function setEmailVisible(scope: keyof EmailVisibility, visible: boolean) {
    emailVisibility.value = { ...emailVisibility.value, [scope]: visible }
    try {
      await authSetEmailVisible(scope, visible)
    } catch {
      emailVisibility.value = { ...emailVisibility.value, [scope]: !visible }
    }
  }

  async function logout() {
    if (token.value) await authLogout().catch(() => {})
    token.value = ''
    email.value = ''
    emailVisibility.value = { leaderboard: false, game: false }
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith(ROOM_KEY_PREFIX)) localStorage.removeItem(key)
    }
  }

  return { token, email, emailVisibility, loggedIn, setSession, refresh, setEmailVisible, logout }
}
