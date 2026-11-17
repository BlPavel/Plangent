import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'path'

export default defineConfig({
  plugins: [vue()],
  root: path.resolve(__dirname),
  build: {
    outDir: path.resolve(__dirname, 'dist'),
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      '@contracts': path.resolve(__dirname, '../contracts'),
      '@core': path.resolve(__dirname, 'src/core'),
      '@shared': path.resolve(__dirname, 'src/shared'),
      '@features': path.resolve(__dirname, 'src/features'),
    },
  },
  // A task's workspace sets its own VITE_PORT and PORT, so several copies run side by side.
  server: {
    host: '127.0.0.1',
    port: Number(process.env.VITE_PORT ?? 5173),
    strictPort: true,
    proxy: {
      // The server listens on 127.0.0.1 only: `localhost` would also try ::1 first.
      '/api': { target: `http://127.0.0.1:${process.env.PORT ?? 3001}`, changeOrigin: true },
      '/ws': { target: `ws://127.0.0.1:${process.env.PORT ?? 3001}`, ws: true },
    },
  },
})
