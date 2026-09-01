import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// GitHub Pages project site base: /<owner>.github.io/logviewplus-web/
// Workers: use native `new Worker(new URL('./x.worker.ts', import.meta.url))` — no plugin needed.
export default defineConfig({
  base: '/logviewplus-web/',
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/unit/**/*.test.ts'],
  },
})
