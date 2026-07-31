/**
 * Exportação do projecto — F2-09.
 *
 * Exporta um {@link ProjectV1} para um directório de saída, escrevendo
 * `project.json` (atomicamente via iso-core) e copiando os atlas referenciados.
 *
 * O artefacto exportado é o CONTRATO com o runtime. Caminhos RELATIVOS ao
 * arquivo de projecto.
 *
 * ## Regras
 *
 * - Escrita atómica de `project.json` via `saveProject` do iso-core.
 * - Atlas copiados para o directório de saída, preservando caminhos relativos.
 * - Verifica que cada atlas referenciado EXISTE em disco antes de declarar
 *   sucesso.
 * - Falha por AUSÊNCIA: exportar com atlas faltando FALHA com nome do arquivo.
 * - Todo texto de erro em pt-BR.
 */

import {
  saveProject,
  type ProjectV1,
} from '@isometric-maker/iso-core/project';
import { copyFile, mkdir, access } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

// ------------------------------------------------------------------ API pública

/**
 * Exporta um projecto para um directório de saída.
 *
 * Procedimento:
 * 1. Cria o directório de saída (e pais, se necessário).
 * 2. Para cada atlas em `project.atlas`:
 *    a. Resolve o caminho absoluto a partir de `projectDir`.
 *    b. Verifica que o ficheiro existe (`access`).
 *    c. Copia para `outputDir`, preservando o caminho relativo.
 * 3. Escreve `project.json` atomicamente em `outputDir`.
 *
 * @param project - Projecto a exportar.
 * @param projectDir - Directório onde o projecto reside (para resolver
 *   caminhos relativos dos atlas).
 * @param outputDir - Directório de destino da exportação.
 * @throws {Error} Se algum atlas referenciado não existir em disco.
 */
export async function exportProject(
  project: ProjectV1,
  projectDir: string,
  outputDir: string,
): Promise<void> {
  const atlasFaltantes: string[] = [];

  // 1. Verifica existência de todos os atlas antes de copiar
  for (const atlasRelPath of project.atlas) {
    const srcAbs = resolve(projectDir, atlasRelPath);
    try {
      await access(srcAbs);
    } catch {
      atlasFaltantes.push(atlasRelPath);
    }
  }

  if (atlasFaltantes.length > 0) {
    throw new Error(
      `Exportação falhou: ${atlasFaltantes.length} atlas não encontrado(s): ` +
        atlasFaltantes.map((a) => `"${a}"`).join(', ') +
        `. Verifique se os ficheiros existem em "${projectDir}".`,
    );
  }

  // 2. Cria directório de saída
  await mkdir(outputDir, { recursive: true });

  // 3. Copia atlas
  for (const atlasRelPath of project.atlas) {
    const srcAbs = resolve(projectDir, atlasRelPath);
    const dstAbs = join(outputDir, atlasRelPath);

    // Cria directórios pais do atlas no destino
    await mkdir(dirname(dstAbs), { recursive: true });

    await copyFile(srcAbs, dstAbs);
  }

  // 4. Escreve project.json (atómica via iso-core)
  const projectJsonPath = join(outputDir, 'project.json');
  await saveProject(project, projectJsonPath);
}

// ------------------------------------------------------------------ verificação pós-exportação

/**
 * Verifica que um directório de exportação contém `project.json` e todos
 * os atlas listados no projecto.
 *
 * @param outputDir - Directório da exportação.
 * @param project - Projecto que foi exportado.
 * @throws {Error} Se `project.json` ou algum atlas estiver em falta.
 */
export async function verifyExport(
  outputDir: string,
  project: ProjectV1,
): Promise<void> {
  const faltantes: string[] = [];

  // Verifica project.json
  const projectJsonPath = join(outputDir, 'project.json');
  try {
    await access(projectJsonPath);
  } catch {
    faltantes.push('project.json');
  }

  // Verifica cada atlas
  for (const atlasRelPath of project.atlas) {
    const atlasPath = join(outputDir, atlasRelPath);
    try {
      await access(atlasPath);
    } catch {
      faltantes.push(atlasRelPath);
    }
  }

  if (faltantes.length > 0) {
    throw new Error(
      `Verificação de exportação falhou: ` +
        `${faltantes.length} ficheiro(s) em falta: ` +
        faltantes.map((f) => `"${f}"`).join(', ') +
        `. O directório "${outputDir}" está incompleto.`,
    );
  }
}
