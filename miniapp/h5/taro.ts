type RectCallback = (rect: DOMRect | null) => void

function params(): Record<string, string> {
  const out: Record<string, string> = {}
  const queries = [location.search, location.hash.split('?')[1] ?? '']
  for (const query of queries) {
    for (const [key, value] of new URLSearchParams(query)) out[key] = value
  }
  return out
}

const Taro = {
  getStorageSync(key: string): unknown {
    const raw = localStorage.getItem(key)
    return raw == null ? '' : JSON.parse(raw)
  },
  setStorageSync(key: string, value: unknown): void {
    localStorage.setItem(key, JSON.stringify(value))
  },
  getSystemInfoSync() {
    return { windowWidth: window.innerWidth, windowHeight: window.innerHeight }
  },
  getCurrentInstance() {
    return { router: { params: params() } }
  },
  createSelectorQuery() {
    let selector = ''
    let callback: RectCallback = () => {}
    const query = {
      select(s: string) {
        selector = s
        return query
      },
      boundingClientRect(cb: RectCallback) {
        callback = cb
        return query
      },
      exec() {
        callback(document.querySelector(selector)?.getBoundingClientRect() ?? null)
      },
    }
    return query
  },
}

export function useShareAppMessage(): void {}

export default Taro
