import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  root: '.',
  base: './',
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'shared'),
      '@core': path.resolve(__dirname, 'core'),
      '@renderer': path.resolve(__dirname, 'renderer'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: true,
    host: '127.0.0.1',  // 强制 IPv4,避免 IPv6 (::1) 端口被占导致起不来
  },
});
