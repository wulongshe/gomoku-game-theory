import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { zipSync } from 'fflate'

const dist = resolve(import.meta.dirname, '../dist')
const out = resolve(import.meta.dirname, '../gomoku-minitool.zip')

const files: Record<string, Uint8Array> = {}
for (const entry of readdirSync(dist, { recursive: true, withFileTypes: true })) {
  if (!entry.isFile()) continue
  const path = join(entry.parentPath, entry.name)
  files[relative(dist, path).split('\\').join('/')] = readFileSync(path)
}

writeFileSync(out, zipSync(files, { level: 9 }))
console.log(out)
