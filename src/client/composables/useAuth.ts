import { computed } from 'vue'
import { useStorage } from '@vueuse/core'
import { authLogout, authMe, type AuthSession } from '~/apis'

const token = useStorage('auth-token', '')
const email = useStorage('auth-email', '')

export function useAuth() {
  const loggedIn = computed(() => Boolean(token.value))

  function setSession(session: AuthSession) {
    token.value = session.token
    email.value = session.email
  }

  async function refresh() {
    if (!token.value) return
    try {
      const current = await authMe(token.value)
      if (current === null) {
        token.value = ''
        email.value = ''
      } else {
        email.value = current
      }
    } catch {}
  }

  async function logout() {
    if (token.value) await authLogout(token.value).catch(() => {})
    token.value = ''
    email.value = ''
  }

  return { email, loggedIn, setSession, refresh, logout }
}
