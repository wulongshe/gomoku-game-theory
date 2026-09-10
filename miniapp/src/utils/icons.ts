// 小程序模板不能内联 svg，图标转成 data URI 交给 image 渲染；路径与 web 的 icons/ 同源。
function svgIcon(body: string, color: string): string {
  return (
    'data:image/svg+xml;utf8,' +
    encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`,
    )
  )
}

export const helpIcon = (color: string) =>
  svgIcon(
    '<circle cx="12" cy="12" r="9"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
    color,
  )
