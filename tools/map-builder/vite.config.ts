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
/**
 * A porta do Sprite Studio é configurável por `STUDIO_PORT`.
 *
 * Num repositório com git worktree existem DUAS cópias do editor rodando, e a
 * segunda cai em portas alternativas. Sem o override, a cópia da worktree faz
 * proxy para o Studio da cópia principal — e então ela lê o catálogo do outro
 * mundo sem dizer nada, que é o tipo de confusão que custa uma tarde.
 */
const STUDIO = `http://localhost:${process.env.STUDIO_PORT ?? '5174'}`;

export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, './src') },
    // packages/iso-core entra por `file:`.
    preserveSymlinks: false,
  },
  server: {
    port: Number(process.env.MAP_PORT ?? 5175),
    // `packages/iso-core` fica fora da raiz desta ferramenta, e numa worktree o
    // `node_modules` costuma ser link para o do repositório principal — os dois
    // casos caem fora do `fs.allow` padrão e viram 403 no meio do carregamento.
    fs: { allow: ['..', '../..', '../../..'] },
    proxy: {
      '/api': { target: STUDIO, changeOrigin: true },
      '/world-blocks': { target: STUDIO, changeOrigin: true },
      '/assets': { target: STUDIO, changeOrigin: true },
    },
  },
  plugins: [react(), tailwindcss()],
});
