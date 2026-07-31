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
});
