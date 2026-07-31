import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173
  },
  base: '/', // Usar rutas relativas para producción
  build: {
    outDir: process.env.VITE_BUILD_OUT_DIR || 'dist',
    assetsDir: 'assets'
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.js',
    restoreMocks: true,
    clearMocks: true
  }
})
