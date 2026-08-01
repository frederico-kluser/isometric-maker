import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * O map-builder não tem servidor próprio: a paleta de blocos e os PNGs vêm do
 * character-builder (5174), que é onde a geração acontece e onde os assets
 * moram. O proxy evita duplicar arquivo gerado em dois lugares — asset pago
 * tem UMA cópia, e ela fica onde foi gravada.
 */
export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, './src') },
    // packages/iso-core entra por `file:`.
    preserveSymlinks: false,
  },
  server: {
    port: 5175,
    proxy: {
      '/api': { target: 'http://localhost:5174', changeOrigin: true },
      '/world-blocks': { target: 'http://localhost:5174', changeOrigin: true },
      '/assets': { target: 'http://localhost:5174', changeOrigin: true },
    },
  },
  plugins: [react(), tailwindcss()],
});
