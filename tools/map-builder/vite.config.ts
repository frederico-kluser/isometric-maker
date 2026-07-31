import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5175,
  },
  // Permite acesso a packages/iso-core (link simbólico ou file:)
  resolve: {
    preserveSymlinks: false,
  },
});
