import { defineConfig } from 'vite';
import { handle } from './server/api.ts';

/**
 * The API lives as dev-server middleware so the PixelLab token stays in Node.
 * A browser-side fetch to api.pixellab.ai would put the secret in devtools, and
 * this tool spends real money.
 */
export default defineConfig({
  server: {
    port: 5174,
    fs: { allow: ['..', '../..'] },
  },
  // Generated art is written to assets/ at runtime; serving it as public means
  // new files appear without a rebuild.
  publicDir: 'assets',
  plugins: [
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
});
