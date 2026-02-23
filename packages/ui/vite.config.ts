import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Deployed behind Traefik at /orbit-core with StripPrefix(/orbit-core)
  // so built assets must include the /orbit-core base path.
  base: '/orbit-core/',
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true
      }
    }
  }
});
