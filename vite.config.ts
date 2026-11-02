import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // ws: the teacher page's live updates (/api/ws) go through the same proxy
    proxy: { '/api': { target: 'http://localhost:3001', ws: true } },
  },
});
