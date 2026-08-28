// Node 原生跑 TS 不做扩展名搜索：路径类导入（相对/绝对/file URL）解析失败时补 .ts 再试一次。
// 主进程经 --import 加载；Worker 继承 execArgv，同样生效。
import { registerHooks } from 'node:module'

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context)
    } catch (error) {
      const isPath =
        specifier.startsWith('./') ||
        specifier.startsWith('../') ||
        specifier.startsWith('/') ||
        specifier.startsWith('file:')
      if (
        (error as { code?: string }).code === 'ERR_MODULE_NOT_FOUND' &&
        isPath &&
        !specifier.endsWith('.ts')
      ) {
        return nextResolve(specifier + '.ts', context)
      }
      throw error
    }
  },
})
