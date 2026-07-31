#!/usr/bin/env node
/**
 * Ponto de entrada do runtime — `npm run play -- <projeto.json>`.
 *
 * 1. Carrega o projecto e valida os atlas (F4-01).
 * 2. Arranca o Vite com um plugin que injecta os dados do projecto no browser
 *    e serve os ficheiros de atlas do directório do projecto.
 *
 * Sem argumento, imprime o uso e sai com exit code ≠ 0.
 */
import { createServer } from 'vite';
import { readFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { loadRuntimeProject } from './load.ts';

// ------------------------------------------------------------------ tipos

/**
 * Subconjunto mínimo do Sidecar que o runtime precisa.
 *
 * O formato completo está definido em tools/pixellab-pipeline/src/atlas.ts,
 * mas o runtime não importa de tools/ — a regra da fronteira (F4-03) proíbe.
 */
interface SidecarMin {
  readonly anchor: { readonly x: number; readonly y: number };
  readonly anchorSource: 'medida' | 'padrao';
  readonly anchorCanvas?: { readonly w: number; readonly h: number };
  readonly fps: Record<string, number>;
}

// ------------------------------------------------------------------ main

const projectPath = process.argv[2];

if (!projectPath) {
  console.error('Uso: npm run play -- <caminho-do-projeto.json>');
  console.error('');
  console.error('  Carrega um projecto isometric-maker e abre o runtime no navegador.');
  console.error('  O projecto deve conter schemaVersion: 1 e atlas válidos.');
  console.error('');
  console.error('  Exemplo:');
  console.error('    npm run play -- ../meu-jogo/project.json');
  process.exit(1);
}

const runtimeProject = await loadRuntimeProject(projectPath);

// Lê todos os sidecars para injectar no browser.
const sidecars: Record<string, SidecarMin> = {};
for (const sidecarPath of runtimeProject.atlasSidecars) {
  const raw = await readFile(sidecarPath, 'utf-8');
  const parsed = JSON.parse(raw) as SidecarMin;
  // Validação mínima: o sidecar tem de ter anchor.
  if (!parsed.anchor || typeof parsed.anchor.x !== 'number') {
    throw new Error(`Sidecar inválido (sem anchor): ${sidecarPath}`);
  }
  sidecars[sidecarPath] = parsed;
}

// ------------------------------------------------------------------ Vite

const projectDir = runtimeProject.projectDir;

const server = await createServer({
  configFile: false,
  root: resolve(import.meta.dirname!, '..'),
  server: {
    open: true,
    fs: {
      // Permite que o Vite sirva ficheiros do directório do projecto.
      allow: [resolve(import.meta.dirname!, '..'), projectDir],
    },
  },
  plugins: [
    {
      name: 'runtime-project',
      configureServer(viteServer) {
        // Middleware para injectar os dados do projecto no browser.
        viteServer.middlewares.use((req, res, next) => {
          if (!req.url) return next();

          const url = new URL(req.url, 'http://localhost');

          // GET /__project__.json → dados do projecto + sidecars + caminhos.
          if (url.pathname === '/__project__.json') {
            // Mapeia caminhos absolutos para URLs (relativos ao directório
            // do projecto) para que o browser os consiga referenciar.
            const mapPath = (abs: string): string => {
              const rel = relative(projectDir, abs);
              return `/__atlas__/${rel}`;
            };

            const payload = {
              project: runtimeProject.project,
              sidecars: Object.fromEntries(
                Object.entries(sidecars).map(([abs, s]) => [mapPath(abs), s]),
              ),
              atlasSheets: runtimeProject.atlasSheets.map(mapPath),
              atlasSidecars: runtimeProject.atlasSidecars.map(mapPath),
            };

            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(payload));
            return;
          }

          // GET /__atlas__/* → serve ficheiros do directório do projecto.
          if (url.pathname.startsWith('/__atlas__/')) {
            const relPath = url.pathname.slice('/__atlas__/'.length);
            // Por segurança, rejeita path traversal.
            if (relPath.includes('..')) {
              res.statusCode = 403;
              res.end('Forbidden');
              return;
            }
            const absPath = resolve(projectDir, relPath);
            // Garante que o caminho está dentro do projectDir.
            if (!absPath.startsWith(projectDir)) {
              res.statusCode = 403;
              res.end('Forbidden');
              return;
            }
            // Deixa o Vite servir o ficheiro estático.
            req.url = absPath;
          }

          next();
        });
      },
    },
  ],
});

await server.listen();

server.printUrls();
console.log(`  Projecto: ${projectPath}`);
console.log(`  Atlas:     ${runtimeProject.atlasSheets.length}`);
