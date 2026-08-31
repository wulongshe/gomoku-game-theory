import { computed, ref } from 'vue'
import { useStorage } from '@vueuse/core'
import { authLogout, authMe, authSetEmailVisible, type AuthSession } from '~/apis'
import { useAuthToken } from '~/composables/useAuthToken'
import { ROOM_KEY_PREFIX } from '~/constants/storage'

const token = useAuthToken()
const email = useStorage('auth-email', '')
const emailVisible = ref(false)

export function useAuth() {
  const loggedIn = computed(() => Boolean(token.value))

  function setSession(session: AuthSession) {
    token.value = session.token
    email.value = session.email
    emailVisible.value = false
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
        emailVisible.value = profile.emailVisible
      }
    } catch {}
  }

  async function setEmailVisible(visible: boolean) {
    emailVisible.value = visible
    try {
      await authSetEmailVisible(visible)
    } catch {
      emailVisible.value = !visible
    }
  }

  async function logout() {
    if (token.value) await authLogout().catch(() => {})
    token.value = ''
    email.value = ''
    emailVisible.value = false
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith(ROOM_KEY_PREFIX)) localStorage.removeItem(key)
    }
  }

  return { token, email, emailVisible, loggedIn, setSession, refresh, setEmailVisible, logout }
}
