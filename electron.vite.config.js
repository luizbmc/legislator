import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve('electron/main/index.js') },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve('electron/preload/index.js') },
      },
    },
  },
  renderer: {
    root: '.',
    server: {
      port: 5174,  // evita conflito com a Ninho (5173)
    },
    build: {
      rollupOptions: {
        input: { index: resolve('index.html') },
      },
    },
    resolve: {
      alias: { '@': resolve('src') },
    },
    plugins: [react()],
  },
})
