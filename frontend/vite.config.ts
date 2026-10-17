import path from 'node:path';
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:5000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: { modules: { classNameStrategy: 'non-scoped' } },
    alias: {
      // React 19 removed act from react-dom/test-utils; shim re-exports from react
      'react-dom/test-utils': path.resolve(__dirname, 'src/test/react-dom-test-utils-shim.ts'),
    },
  },
})
