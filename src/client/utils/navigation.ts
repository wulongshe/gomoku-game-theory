// 离开当前页优先按历史回退（保留来路）；直达链接/新标签无可退历史时改用 replace，
// 不新增历史记录，避免「后退」又弹回已失效的对局页。
export function backOrReplace(fallback = '/'): void {
  if (history.length > 1) history.back()
  else location.replace(fallback)
}
