import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          // Vue core + vue-router + pinia
          if (id.includes('node_modules/vue/') ||
              id.includes('node_modules/@vue/') ||
              id.includes('node_modules/vue-router/') ||
              id.includes('node_modules/pinia/')) {
            return 'vue-vendor';
          }
          // reka-ui (shadcn-vue primitives)
          if (id.includes('node_modules/reka-ui/')) {
            return 'reka-ui';
          }
          // Lucide icons
          if (id.includes('node_modules/lucide-vue-next/')) {
            return 'icons';
          }
          // VueUse
          if (id.includes('node_modules/@vueuse/')) {
            return 'vueuse';
          }
          // Vue Flow (diagram/graph)
          if (id.includes('node_modules/@vue-flow/')) {
            return 'vue-flow';
          }
        },
      },
    },
  },
  server: {
    host: process.env.VITE_HOST || 'localhost',
    port: 5174,
    proxy: {
      '/api': 'http://localhost:3010',
      '/ws': {
        target: 'ws://localhost:3010',
        ws: true,
      },
    },
  },
})
