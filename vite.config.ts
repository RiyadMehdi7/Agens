import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const apiPort = Number(process.env.PORT || 5190);

// The API checks Host and Origin against APP_ORIGIN, so the proxy must not rewrite them.
// Run the API with APP_ORIGIN=http://127.0.0.1:5173 (or the forwarded frontend origin).
export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: { '/api': { target: `http://127.0.0.1:${apiPort}`, changeOrigin: false } },
  },
  build: { outDir: 'dist/web', emptyOutDir: true },
});
