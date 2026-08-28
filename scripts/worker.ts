// 通用 Worker RPC：workerData 指定 { module, fn }（module 为绝对 file URL），
// 收到 { id, args } 转发给该函数，回 { id, result }。
import { parentPort, workerData } from 'node:worker_threads'

const { module: modulePath, fn } = workerData as { module: string; fn: string }
const handler = (await import(modulePath))[fn] as (...args: unknown[]) => unknown

parentPort!.on('message', async ({ id, args }: { id: number; args: unknown[] }) => {
  parentPort!.postMessage({ id, result: await handler(...args) })
})
