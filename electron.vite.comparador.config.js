import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    build: {
      outDir: 'out-comparador/main',
      rollupOptions: { input: { index: resolve('electron/comparador/main.js') } },
    },
  },
  renderer: {
    root: 'comparador',
    server: { port: 5175 },
    build: {
      outDir: 'out-comparador/renderer',
      rollupOptions: { input: { index: resolve('comparador/index.html') } },
    },
    resolve: { alias: { '@': resolve('src') } },
    plugins: [react()],
  },
})
