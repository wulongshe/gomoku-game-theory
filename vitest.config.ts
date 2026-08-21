import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      {
        resolve: {
          alias: {
            '@': fileURLToPath(new URL('./src', import.meta.url)),
          },
        },
        test: {
          name: 'engine',
          include: ['src/engine/**/*.test.ts'],
        },
      },
      './vitest.workers.config.ts',
    ],
  },
})
