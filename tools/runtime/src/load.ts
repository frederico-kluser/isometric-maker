/**
 * Carregamento do projecto de runtime.
 *
 * `loadRuntimeProject(caminho)` carrega um project.json, resolve todos os
 * atlas referenciados relativamente ao directório do ficheiro de projecto,
 * e verifica que cada ficheiro existe.
 *
 * Esta função corre em Node.js — usa `node:fs/promises` para aceder ao disco.
 * O resultado é serializado e injectado no bundle do browser pelo `play.ts`.
 */
import { access } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { loadProject, type ProjectV1 } from '@isometric-maker/iso-core/project';

// ------------------------------------------------------------------ tipos

export interface RuntimeProject {
  /** O projecto carregado do disco. */
  readonly project: ProjectV1;
  /** Directório onde o project.json reside (base para caminhos relativos). */
  readonly projectDir: string;
  /** Caminhos ABSOLUTOS para os sidecars `.pixellab.json`. */
  readonly atlasSidecars: readonly string[];
  /** Caminhos ABSOLUTOS para os spritesheets `.json` (TexturePacker JSON Hash). */
  readonly atlasSheets: readonly string[];
}

// ------------------------------------------------------------------ load

/**
 * Carrega e valida um projecto de runtime.
 *
 * 1. Chama `loadProject` do iso-core para validar a versão do schema.
 * 2. Para cada entrada em `project.atlas`, resolve o caminho absoluto
 *    relativamente ao directório do ficheiro de projecto.
 * 3. Verifica que o sidecar `.pixellab.json` existe.
 * 4. Deriva o caminho do spritesheet `.json` (mesmo nome base, extensão `.json`).
 * 5. Verifica que o spritesheet também existe.
 *
 * @param projectPath Caminho absoluto ou relativo para o ficheiro project.json.
 * @returns Projecto carregado com todos os caminhos resolvidos.
 * @throws Se o projecto tiver schemaVersion != 1 ou algum atlas estiver em falta.
 */
export async function loadRuntimeProject(
  projectPath: string,
): Promise<RuntimeProject> {
  const project = await loadProject(projectPath);
  const projectDir = dirname(projectPath);

  const atlasSidecars: string[] = [];
  const atlasSheets: string[] = [];
  const missing: string[] = [];

  for (const atlasRel of project.atlas) {
    // O atlasRel aponta para um sidecar .pixellab.json.
    const sidecarAbs = resolve(projectDir, atlasRel);
    try {
      await access(sidecarAbs);
    } catch {
      missing.push(atlasRel);
      continue;
    }
    atlasSidecars.push(sidecarAbs);

    // O spritesheet está no mesmo directório, com extensão .json
    // em vez de .pixellab.json.  Ex.: criatura.pixellab.json → criatura.json
    const sheetRel = atlasRel.replace(/\.pixellab\.json$/i, '.json');
    const sheetAbs = resolve(projectDir, sheetRel);
    try {
      await access(sheetAbs);
    } catch {
      missing.push(sheetRel);
      continue;
    }
    atlasSheets.push(sheetAbs);
  }

  if (missing.length > 0) {
    throw new Error(
      `Atlas em falta:\n${missing.map((m) => `  - ${m}`).join('\n')}`,
    );
  }

  return { project, projectDir, atlasSidecars, atlasSheets };
}
