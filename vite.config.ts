import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';

export default defineConfig(({ mode }) => ({
  plugins: mode === 'https' ? [react(), basicSsl()] : [react()],
  server: {
    host: true,
    allowedHosts: true,
  },
  build: {
    target: 'es2020',
  },
}));
