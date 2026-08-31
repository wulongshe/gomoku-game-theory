import { useStorage } from '@vueuse/core'

// 账号鉴权 token 的持久化单例：apis 读取用于鉴权，useAuth 负责写入/清除。
// 单例保证 apis 与 useAuth 拿到同一 ref，故在 computed 里构造带鉴权 URL 时能随登录态自动更新。
const token = useStorage('auth-token', '')

export function useAuthToken() {
  return token
}
