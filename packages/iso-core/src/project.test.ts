import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  criarProject,
  loadProject,
  saveProject,
  type ProjectV1,
} from './project.ts';
import { type MapData } from './map.ts';

describe('project v1', () => {
  /** Directório temporário descartável para cada bloco. */
  async function tmpDir(): Promise<string> {
    return mkdtemp(join(tmpdir(), 'iso-core-test-'));
  }

  // ------------------------------------------------------------------
  // Ida e volta
  // ------------------------------------------------------------------

  it('round-trip: saveProject → loadProject devolve o mesmo objeto', async () => {
    const dir = await tmpDir();
    const filePath = join(dir, 'projeto.json');

    const atlas = ['personagens/lobo.pixellab.json', 'tiles/grama.pixellab.json'];
    const original = criarProject('mundo-teste', atlas);

    await saveProject(original, filePath);
    const loaded = await loadProject(filePath);

    assert.deepStrictEqual(loaded, original);

    await rm(dir, { recursive: true, force: true });
  });

  // ------------------------------------------------------------------
  // Rejeição
  // ------------------------------------------------------------------

  it('rejeita JSON sem schemaVersion', async () => {
    const dir = await tmpDir();
    const filePath = join(dir, 'sem-versao.json');

    await writeFile(
      filePath,
      JSON.stringify({ nome: 'orphan', geometria: {} }),
      'utf-8',
    );

    await assert.rejects(
      async () => loadProject(filePath),
      (err: unknown) =>
        err instanceof Error && err.message.includes('schemaVersion ausente'),
    );

    await rm(dir, { recursive: true, force: true });
  });

  it('rejeita schemaVersion desconhecida (v2)', async () => {
    const dir = await tmpDir();
    const filePath = join(dir, 'futuro.json');

    await writeFile(
      filePath,
      JSON.stringify({ schemaVersion: 2, nome: 'futuro' }),
      'utf-8',
    );

    await assert.rejects(
      async () => loadProject(filePath),
      (err: unknown) =>
        err instanceof Error && err.message.includes('schema desconhecida'),
    );

    await rm(dir, { recursive: true, force: true });
  });

  it('rejeita schemaVersion desconhecida (v0)', async () => {
    const dir = await tmpDir();
    const filePath = join(dir, 'zero.json');

    await writeFile(
      filePath,
      JSON.stringify({ schemaVersion: 0, nome: 'beta' }),
      'utf-8',
    );

    await assert.rejects(
      async () => loadProject(filePath),
      (err: unknown) =>
        err instanceof Error && err.message.includes('schema desconhecida'),
    );

    await rm(dir, { recursive: true, force: true });
  });

  // ------------------------------------------------------------------
  // Escrita atómica
  // ------------------------------------------------------------------

  it('escrita atómica: não deixa ficheiro temporário no destino', async () => {
    const dir = await tmpDir();
    const filePath = join(dir, 'projeto.json');

    const project = criarProject('teste-atomico', []);
    await saveProject(project, filePath);

    // O único .json no diretório deve ser o destino final
    const { readdir } = await import('node:fs/promises');
    const entries = await readdir(dir);
    const tmpFiles = entries.filter((e) => e.startsWith('.project-'));
    assert.strictEqual(
      tmpFiles.length,
      0,
      `Esperado zero ficheiros temporários, encontrados: ${tmpFiles.join(', ')}`,
    );

    await rm(dir, { recursive: true, force: true });
  });

  // ------------------------------------------------------------------
  // Campos obrigatórios
  // ------------------------------------------------------------------

  it('criarProject preenche geometria padrão', () => {
    const project = criarProject('teste', []);

    assert.strictEqual(project.schemaVersion, 1);
    assert.strictEqual(project.geometria.tileWidth, 64);
    assert.strictEqual(project.geometria.tileHeight, 32);
    assert.strictEqual(project.geometria.zStep, 16);
    assert.strictEqual(typeof project.data, 'string');
    // data é ISO-8601 válida
    assert.ok(!Number.isNaN(Date.parse(project.data)));
  });

  // ------------------------------------------------------------------
  // Mapa — integração F2-02
  // ------------------------------------------------------------------

  it('projecto sem mapa é carregado normalmente (retrocompatibilidade)', async () => {
    const dir = await tmpDir();
    const filePath = join(dir, 'sem-mapa.json');

    const project = criarProject('sem-mapa', []);
    await saveProject(project, filePath);
    const loaded = await loadProject(filePath);

    assert.strictEqual(loaded.mapa, undefined);

    await rm(dir, { recursive: true, force: true });
  });

  it('projecto com mapa válido (blocos, arestas, objectos) é carregado', async () => {
    const dir = await tmpDir();
    const filePath = join(dir, 'com-mapa.json');

    const project = criarProject('com-mapa', []);
    const projectComMapa = {
      ...project,
      mapa: {
        blocks: {
          '0:0': [
            { block: 'grass', count: 3 },
            { block: 'dirt', count: 2 },
          ],
        },
        edges: [
          { x: 0, y: 0, z: 0, lado: 'N' as const, tipo: 'stone_wall' },
        ],
        objects: [
          { tipo: 'tree', x: 5, y: 3, z: 0 },
        ],
      } satisfies MapData,
    };

    await saveProject(projectComMapa as ProjectV1, filePath);
    const loaded = await loadProject(filePath);

    assert.ok(loaded.mapa);
    assert.ok(loaded.mapa!.blocks['0:0']);
    assert.strictEqual(loaded.mapa!.edges.length, 1);
    assert.strictEqual(loaded.mapa!.objects!.length, 1);

    await rm(dir, { recursive: true, force: true });
  });

  it('rejeita projecto com objeto multi-célula (cells)', async () => {
    const dir = await tmpDir();
    const filePath = join(dir, 'multi-cell.json');

    const project = criarProject('multi-cell', []);
    const projectInvalido = {
      ...project,
      mapa: {
        blocks: {},
        edges: [],
        objects: [
          {
            tipo: 'building',
            x: 0,
            y: 0,
            z: 0,
            cells: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }],
          },
        ],
      },
    };

    await saveProject(projectInvalido as ProjectV1, filePath);

    await assert.rejects(
      async () => loadProject(filePath),
      (err: unknown) =>
        err instanceof Error && err.message.includes('multi-célula'),
    );

    await rm(dir, { recursive: true, force: true });
  });

  it('rejeita projecto com objeto multi-célula (width/height)', async () => {
    const dir = await tmpDir();
    const filePath = join(dir, 'multi-cell-wh.json');

    const project = criarProject('multi-cell-wh', []);
    const projectInvalido = {
      ...project,
      mapa: {
        blocks: {},
        edges: [],
        objects: [
          {
            tipo: 'furniture',
            x: 0,
            y: 0,
            z: 0,
            width: 2,
            height: 3,
          },
        ],
      },
    };

    await saveProject(projectInvalido as ProjectV1, filePath);

    await assert.rejects(
      async () => loadProject(filePath),
      (err: unknown) =>
        err instanceof Error && err.message.includes('multi-célula'),
    );

    await rm(dir, { recursive: true, force: true });
  });

  it('projecto com mapa sem objects é válido', async () => {
    const dir = await tmpDir();
    const filePath = join(dir, 'sem-objects.json');

    const project = criarProject('sem-objects', []);
    const projectSemObjects = {
      ...project,
      mapa: {
        blocks: {
          '0:0': [{ block: 'grass', count: 1 }],
        },
        edges: [],
      },
    };

    await saveProject(projectSemObjects as ProjectV1, filePath);
    const loaded = await loadProject(filePath);

    assert.ok(loaded.mapa);
    assert.strictEqual(loaded.mapa!.objects, undefined);

    await rm(dir, { recursive: true, force: true });
  });
});
