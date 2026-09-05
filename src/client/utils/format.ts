export function frameLabel(seconds: number): string {
  return seconds ? `${seconds}s` : '不限时'
}

// 每日开赛时点文案：由下一场开赛时间戳按本地时区取 HH:MM。
export function formatDailyTime(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function formatCountdown(totalSeconds: number): string {
  const s = Math.max(0, totalSeconds)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`
}
