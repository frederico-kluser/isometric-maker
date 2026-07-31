import { defineConfig } from 'vite';

export default defineConfig({
  // O runtime é servido via src/play.ts, que arranca o Vite programaticamente.
  // Esta config existe para typecheck e para referência.
  base: './',
  server: {
    open: false,
  },
});
