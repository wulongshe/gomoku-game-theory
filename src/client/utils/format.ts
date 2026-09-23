export function frameLabel(seconds: number): string {
  return seconds ? `${seconds}s` : '不限时'
}
