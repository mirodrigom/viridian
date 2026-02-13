import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import path from 'path'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: [
        'src/**/*.{js,ts,vue}',
      ],
      exclude: [
        'src/test/**',
        'src/**/*.test.{js,ts}',
        'src/**/*.spec.{js,ts}',
        'src/main.ts',
        'src/router/**',
        'src/types/**',
      ],
    },
  },
})