export function frameLabel(seconds: number): string {
  return seconds ? `${seconds}s` : '不限时'
}

// 时间戳按本地时区取 HH:MM。
export function formatClock(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}
