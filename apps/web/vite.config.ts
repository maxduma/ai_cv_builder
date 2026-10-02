import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The browser only calls relative `/api/*` URLs and the dev server forwards them to the API,
// so there is no CORS to configure and the app also works when opened from a phone on the LAN.
// Inside Docker Compose the API is reachable at http://api:4000.
const apiProxyTarget = process.env.API_PROXY_TARGET ?? 'http://localhost:4000';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: true, // listen on all interfaces: required inside Docker and for testing on a phone
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: apiProxyTarget, changeOrigin: true },
    },
  },
});
