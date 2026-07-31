import path from 'node:path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { handle } from './server/api.ts';

/**
 * The API lives as dev-server middleware so the PixelLab token stays in Node.
 * A browser-side fetch to api.pixellab.ai would put the secret in devtools, and
 * this tool spends real money.
 */
export default defineConfig(({ mode }) => {
  // Load .env into process.env so server-side code reads PIXELLAB_SECRET.
  // Shell exports override .env — the dev never loses control.
  const root = import.meta.dirname;
  const env = loadEnv(mode, root, '');
  for (const [key, value] of Object.entries(env)) {
    if (!process.env[key]) process.env[key] = value;
  }

  return {
  resolve: { alias: { '@': path.resolve(root, './src') } },
  server: {
    port: 5174,
    fs: { allow: ['..', '../..'] },
    watch: {
      // studio.json and assets/ change at runtime (PixelLab generation) —
      // hot reload would disrupt the user mid-work.
      ignored: ['**/studio.json', '**/assets/**'],
    },
  },
  // Generated art is written to assets/ at runtime; serving it as public means
  // new files appear without a rebuild.
  publicDir: 'assets',
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'character-builder-api',
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          const handled = await handle(req, res).catch((err: unknown) => {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: String(err) }));
            return true;
          });
          if (!handled) next();
        });
      },
    },
  ],
  };
});
