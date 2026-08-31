export function frameLabel(seconds: number): string {
  return seconds ? `${seconds}s` : '不限时'
}

export function formatCountdown(totalSeconds: number): string {
  const s = Math.max(0, totalSeconds)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`
}
