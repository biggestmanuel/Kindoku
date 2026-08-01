import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// During local dev, run `vercel dev` in a separate terminal (it serves
// your existing /api/recommend.js on port 3000 unchanged), then `npm run
// dev` here. Vite proxies /api calls straight through so the frontend
// code never needs to know the difference between dev and prod.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
});
