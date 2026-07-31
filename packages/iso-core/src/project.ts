import { randomUUID } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

// ---------------------------------------------------------------------------
// Tipos do formato de projeto v1
// ---------------------------------------------------------------------------

export interface ProjectGeometry {
  readonly tileWidth: number;
  readonly tileHeight: number;
  readonly zStep: number;
}

export interface ProjectV1 {
  readonly schemaVersion: 1;
  readonly nome: string;
  /** ISO-8601 da última alteração. */
  readonly data: string;
  readonly geometria: ProjectGeometry;
  /** Caminhos relativos aos sidecars .pixellab.json. */
  readonly atlas: readonly string[];
  /** Dados do mapa — F2-02 é o dono deste campo. */
  readonly mapa?: Record<string, never>;
}

/** União preparada para versões futuras. */
export type Project = ProjectV1;

// ---------------------------------------------------------------------------
// Constantes do formato
// ---------------------------------------------------------------------------

const SCHEMA_VERSION = 1 as const;

const GEOMETRIA_PADRAO: ProjectGeometry = {
  tileWidth: 64,
  tileHeight: 32,
  zStep: 16,
} as const;

// ---------------------------------------------------------------------------
// Fábrica
// ---------------------------------------------------------------------------

export function criarProject(
  nome: string,
  atlas: readonly string[],
): ProjectV1 {
  return {
    schemaVersion: SCHEMA_VERSION,
    nome,
    data: new Date().toISOString(),
    geometria: GEOMETRIA_PADRAO,
    atlas,
  };
}

// ---------------------------------------------------------------------------
// Persistência
// ---------------------------------------------------------------------------

/**
 * Escrita atómica: serializa para um ficheiro temporário no mesmo directório e
 * renomeia para o destino.  No mesmo filesystem, rename é atómico no Linux.
 */
export async function saveProject(
  project: ProjectV1,
  filePath: string,
): Promise<void> {
  const json = JSON.stringify(project, null, 2);
  const tmpPath = join(dirname(filePath), `.project-${randomUUID()}.tmp`);
  await writeFile(tmpPath, json, 'utf-8');
  await rename(tmpPath, filePath);
}

/**
 * Carrega um projecto e rejeita qualquer `schemaVersion` diferente de 1.
 *
 * A validação é mínima de propósito — o schema completo pertence ao ADR do
 * formato (F0-12). Aqui apenas se verifica o descriminador de versão.
 */
export async function loadProject(filePath: string): Promise<ProjectV1> {
  const raw = await readFile(filePath, 'utf-8');
  const parsed: unknown = JSON.parse(raw);

  if (parsed === null || typeof parsed !== 'object') {
    throw new Error('JSON do projeto inválido: raiz não é objeto');
  }

  if (!('schemaVersion' in parsed)) {
    throw new Error('JSON do projeto inválido: schemaVersion ausente');
  }

  // Após o guard 'in', parsed é `object & Record<"schemaVersion", unknown>` e
  // o acesso a .schemaVersion compila sem index-signature sintético.
  if (parsed.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(
      `Versão de schema desconhecida: ${String(parsed.schemaVersion)}. ` +
        `Este iso-core suporta apenas schemaVersion: ${SCHEMA_VERSION}.`,
    );
  }

  // O descriminador bate — confiamos no resto da forma para esta versão.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- validação de schema feito acima
  return parsed as ProjectV1;
}
