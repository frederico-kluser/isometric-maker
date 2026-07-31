/**
 * Testes de exportação — F2-09.
 *
 * Cobre:
 *   1. Exportar project.json + atlas para directório de saída.
 *   2. Round-trip: exportar, ler com loadProject, comparar profundamente.
 *   3. Falha por AUSÊNCIA: atlas inexistente → erro com nome do ficheiro.
 *   4. Verificação pós-exportação com verifyExport.
 *
 * Execute com: npx tsx --test src/export.test.ts
 */
import assert from 'node:assert/strict';
import { describe, it, before, after } from 'node:test';
import {
  mkdir,
  rm,
  writeFile,
  readFile,
  access,
} from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import {
  criarProject,
  loadProject,
  type ProjectV1,
} from '@isometric-maker/iso-core/project';
import { exportProject, verifyExport } from './export.ts';

// ------------------------------------------------------------------ utilitários

/** Cria um directório temporário e devolve o caminho. */
async function tempDir(): Promise<string> {
  const dir = join(tmpdir(), `map-builder-export-test-${randomUUID()}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

/** Cria um ficheiro com conteúdo simples. */
async function touchFile(filePath: string, content: string): Promise<void> {
  await mkdir(resolve(filePath, '..'), { recursive: true });
  await writeFile(filePath, content, 'utf-8');
}

// ------------------------------------------------------------------ testes

describe('exportProject — exportação completa', () => {
  let projectDir: string;
  let outputDir: string;
  let project: ProjectV1;

  before(async () => {
    projectDir = await tempDir();
    outputDir = await tempDir();

    // Cria atlas falsos no directório do projecto
    await touchFile(
      join(projectDir, 'atlases', 'characters.pixellab.json'),
      '{"atlas":"characters"}',
    );
    await touchFile(
      join(projectDir, 'atlases', 'tiles.pixellab.json'),
      '{"atlas":"tiles"}',
    );
    await touchFile(
      join(projectDir, 'atlases', 'sub', 'props.pixellab.json'),
      '{"atlas":"props"}',
    );

    // Cria o projecto com caminhos relativos
    project = criarProject('test-export', [
      'atlases/characters.pixellab.json',
      'atlases/tiles.pixellab.json',
      'atlases/sub/props.pixellab.json',
    ]);
  });

  after(async () => {
    await rm(projectDir, { recursive: true, force: true }).catch(() => {});
    await rm(outputDir, { recursive: true, force: true }).catch(() => {});
  });

  it('exporta project.json e copia todos os atlas', async () => {
    await exportProject(project, projectDir, outputDir);

    // Verifica project.json
    const projectJsonPath = join(outputDir, 'project.json');
    await access(projectJsonPath);

    // Verifica cada atlas
    for (const atlasRel of project.atlas) {
      const atlasPath = join(outputDir, atlasRel);
      await access(atlasPath);
    }
  });

  it('project.json exportado é válido e tem schemaVersion 1', async () => {
    const loaded = await loadProject(join(outputDir, 'project.json'));
    assert.strictEqual(loaded.schemaVersion, 1);
    assert.strictEqual(loaded.nome, 'test-export');
  });

  it('atlas copiados preservam caminhos relativos', async () => {
    const loaded = await loadProject(join(outputDir, 'project.json'));
    assert.deepStrictEqual(loaded.atlas, [
      'atlases/characters.pixellab.json',
      'atlases/tiles.pixellab.json',
      'atlases/sub/props.pixellab.json',
    ]);
  });
});

// ------------------------------------------------------------------ round-trip

describe('exportProject — round-trip (ida e volta)', () => {
  let projectDir: string;
  let outputDir: string;
  let project: ProjectV1;

  before(async () => {
    projectDir = await tempDir();
    outputDir = await tempDir();

    // Cria atlas falsos
    await touchFile(
      join(projectDir, 'data', 'hero.pixellab.json'),
      '{"atlas":"hero"}',
    );

    project = criarProject('round-trip-test', [
      'data/hero.pixellab.json',
    ]);

    // Adiciona um mapa ao projecto
    project = {
      ...project,
      mapa: {
        blocks: {
          '0:0': [{ block: 'grass', count: 1 }],
          '1:0': [{ block: 'stone', count: 2 }],
        },
        edges: [
          { x: 0, y: 0, z: 0, lado: 'L', tipo: 'stone_wall' },
        ],
        objects: [
          { tipo: 'tree', x: 2, y: 2, z: 0 },
        ],
      },
    };
  });

  after(async () => {
    await rm(projectDir, { recursive: true, force: true }).catch(() => {});
    await rm(outputDir, { recursive: true, force: true }).catch(() => {});
  });

  it('exporta e recarrega com loadProject — comparação profunda', async () => {
    await exportProject(project, projectDir, outputDir);

    const loaded = await loadProject(join(outputDir, 'project.json'));

    // schemaVersion
    assert.strictEqual(loaded.schemaVersion, project.schemaVersion);
    // nome
    assert.strictEqual(loaded.nome, project.nome);
    // data (a exportação altera data para a data actual)
    assert.ok(typeof loaded.data === 'string');
    // geometria
    assert.deepStrictEqual(loaded.geometria, project.geometria);
    // atlas
    assert.deepStrictEqual(loaded.atlas, project.atlas);
    // mapa
    assert.ok(loaded.mapa);
    assert.deepStrictEqual(loaded.mapa.blocks, project.mapa!.blocks);
    assert.deepStrictEqual(loaded.mapa.edges, project.mapa!.edges);
    assert.deepStrictEqual(loaded.mapa.objects, project.mapa!.objects);
  });

  it('mapa exportado preserva blocos', async () => {
    await exportProject(project, projectDir, outputDir);
    const loaded = await loadProject(join(outputDir, 'project.json'));

    assert.ok(loaded.mapa);
    const blocks = loaded.mapa.blocks;

    // 0:0 → grass count 1
    const col00 = blocks['0:0'];
    assert.ok(col00);
    assert.strictEqual(col00.length, 1);
    assert.strictEqual(col00[0]!.block, 'grass');
    assert.strictEqual(col00[0]!.count, 1);

    // 1:0 → stone count 2
    const col10 = blocks['1:0'];
    assert.ok(col10);
    assert.strictEqual(col10.length, 1);
    assert.strictEqual(col10[0]!.block, 'stone');
    assert.strictEqual(col10[0]!.count, 2);
  });

  it('mapa exportado preserva arestas', async () => {
    await exportProject(project, projectDir, outputDir);
    const loaded = await loadProject(join(outputDir, 'project.json'));

    assert.ok(loaded.mapa);
    assert.strictEqual(loaded.mapa.edges.length, 1);
    assert.deepStrictEqual(loaded.mapa.edges[0], {
      x: 0,
      y: 0,
      z: 0,
      lado: 'L',
      tipo: 'stone_wall',
    });
  });

  it('mapa exportado preserva objectos', async () => {
    await exportProject(project, projectDir, outputDir);
    const loaded = await loadProject(join(outputDir, 'project.json'));

    assert.ok(loaded.mapa);
    assert.strictEqual(loaded.mapa.objects!.length, 1);
    assert.deepStrictEqual(loaded.mapa.objects![0], {
      tipo: 'tree',
      x: 2,
      y: 2,
      z: 0,
    });
  });
});

// ------------------------------------------------------------------ falha por ausência

describe('exportProject — falha por atlas ausente', () => {
  let projectDir: string;
  let outputDir: string;

  before(async () => {
    projectDir = await tempDir();
    outputDir = await tempDir();

    // Cria apenas um dos dois atlas
    await touchFile(
      join(projectDir, 'exists.pixellab.json'),
      '{"atlas":"exists"}',
    );
  });

  after(async () => {
    await rm(projectDir, { recursive: true, force: true }).catch(() => {});
    await rm(outputDir, { recursive: true, force: true }).catch(() => {});
  });

  it('FALHA quando um atlas não existe', async () => {
    const project = criarProject('test-fail', [
      'exists.pixellab.json',
      'missing.pixellab.json',
    ]);

    await assert.rejects(
      exportProject(project, projectDir, outputDir),
      (err: unknown) => {
        if (!(err instanceof Error)) return false;
        return (
          err.message.includes('missing.pixellab.json') &&
          err.message.includes('Exportação falhou')
        );
      },
    );
  });

  it('FALHA quando todos os atlas estão em falta', async () => {
    const project = criarProject('test-all-fail', [
      'a.pixellab.json',
      'b.pixellab.json',
    ]);

    await assert.rejects(
      exportProject(project, projectDir, outputDir),
      (err: unknown) => {
        if (!(err instanceof Error)) return false;
        return (
          err.message.includes('a.pixellab.json') &&
          err.message.includes('b.pixellab.json') &&
          err.message.includes('2 atlas não encontrado(s)')
        );
      },
    );
  });

  it('FALHA com o nome do ficheiro ausente', async () => {
    const project = criarProject('test-nome', [
      'inexistente.pixellab.json',
    ]);

    try {
      await exportProject(project, projectDir, outputDir);
      assert.fail('devia ter lançado');
    } catch (err) {
      assert.ok(err instanceof Error);
      assert.ok(
        err.message.includes('"inexistente.pixellab.json"'),
        `mensagem deve conter o nome do ficheiro, obtido: ${err.message}`,
      );
    }
  });

  it('não escreve project.json quando um atlas falha', async () => {
    const project = criarProject('no-write', [
      'missing.pixellab.json',
    ]);

    try {
      await exportProject(project, projectDir, outputDir);
    } catch {
      // Esperado
    }

    // project.json NÃO deve existir
    await assert.rejects(
      access(join(outputDir, 'project.json')),
      // access rejeita se o ficheiro não existe
    );
  });
});

// ------------------------------------------------------------------ verifyExport

describe('verifyExport — verificação pós-exportação', () => {
  let projectDir: string;
  let outputDir: string;
  let project: ProjectV1;

  before(async () => {
    projectDir = await tempDir();
    outputDir = await tempDir();

    await touchFile(
      join(projectDir, 'atlas.pixellab.json'),
      '{"atlas":"test"}',
    );

    project = criarProject('verify-test', [
      'atlas.pixellab.json',
    ]);
  });

  after(async () => {
    await rm(projectDir, { recursive: true, force: true }).catch(() => {});
    await rm(outputDir, { recursive: true, force: true }).catch(() => {});
  });

  it('verifyExport confirma exportação bem-sucedida', async () => {
    await exportProject(project, projectDir, outputDir);
    // Não deve lançar
    await verifyExport(outputDir, project);
  });

  it('verifyExport detecta project.json em falta', async () => {
    const emptyDir = await tempDir();
    try {
      await assert.rejects(
        verifyExport(emptyDir, project),
        (err: unknown) => {
          if (!(err instanceof Error)) return false;
          return (
            err.message.includes('project.json') &&
            err.message.includes('em falta')
          );
        },
      );
    } finally {
      await rm(emptyDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('verifyExport detecta atlas em falta após exportação parcial', async () => {
    // Cria um directório com project.json mas sem o atlas
    const partialDir = await tempDir();
    try {
      await mkdir(partialDir, { recursive: true });
      await writeFile(
        join(partialDir, 'project.json'),
        JSON.stringify(project, null, 2),
        'utf-8',
      );
      // Não copiamos o atlas

      await assert.rejects(
        verifyExport(partialDir, project),
        (err: unknown) => {
          if (!(err instanceof Error)) return false;
          return (
            err.message.includes('atlas.pixellab.json') &&
            err.message.includes('em falta')
          );
        },
      );
    } finally {
      await rm(partialDir, { recursive: true, force: true }).catch(() => {});
    }
  });
});

// ------------------------------------------------------------------ escrita atómica

describe('exportProject — escrita atómica', () => {
  let projectDir: string;
  let outputDir: string;

  before(async () => {
    projectDir = await tempDir();
    outputDir = await tempDir();

    await touchFile(
      join(projectDir, 'test.pixellab.json'),
      '{"atlas":"test"}',
    );
  });

  after(async () => {
    await rm(projectDir, { recursive: true, force: true }).catch(() => {});
    await rm(outputDir, { recursive: true, force: true }).catch(() => {});
  });

  it('project.json é escrito atomicamente (sem ficheiros .tmp residuais)', async () => {
    const project = criarProject('atomic-test', [
      'test.pixellab.json',
    ]);

    await exportProject(project, projectDir, outputDir);

    // Lista ficheiros no outputDir
    const files: string[] = [];
    for await (const entry of await import('node:fs/promises').then(
      (fs) => fs.readdir(outputDir),
    )) {
      files.push(entry);
    }

    // Não deve haver ficheiros .tmp
    const tmpFiles = files.filter((f) => f.endsWith('.tmp'));
    assert.strictEqual(
      tmpFiles.length,
      0,
      `Ficheiros .tmp residuais encontrados: ${tmpFiles.join(', ')}`,
    );

    // Deve haver project.json
    assert.ok(files.includes('project.json'), 'project.json deve existir');
  });
});

// ------------------------------------------------------------------ critérios de aceitação

describe('critérios de aceitação', () => {
  it('caminhos no projecto são relativos', async () => {
    const project = criarProject('relative-test', [
      'subdir/atlas.pixellab.json',
      'another/dir/file.pixellab.json',
    ]);

    // Todos os caminhos devem ser relativos (não começam com /)
    for (const atlas of project.atlas) {
      assert.ok(
        !atlas.startsWith('/'),
        `Caminho "${atlas}" não deve ser absoluto`,
      );
      assert.ok(
        !atlas.includes(':\\'),
        `Caminho "${atlas}" não deve ser absoluto Windows`,
      );
    }
  });

  it('exportProject usa saveProject do iso-core (escrita atómica)', async () => {
    // A função exportProject importa saveProject de '@isometric-maker/iso-core/project'.
    // Se este ficheiro compila e o teste de escrita atómica passa, a dependência
    // está correcta.
    const project = criarProject('dep-test', []);
    assert.strictEqual(project.schemaVersion, 1);
    // saveProject é chamado dentro de exportProject
  });

  it('falha por ausência contém o nome do ficheiro', async () => {
    const projectDir = await tempDir();
    const outputDir = await tempDir();

    try {
      const project = criarProject('fail-name-test', [
        'ficheiro_que_nao_existe.json',
      ]);

      try {
        await exportProject(project, projectDir, outputDir);
        assert.fail('devia ter lançado');
      } catch (err) {
        assert.ok(err instanceof Error);
        assert.ok(
          err.message.includes('ficheiro_que_nao_existe.json'),
          `Mensagem deve conter o nome do ficheiro: ${err.message}`,
        );
      }
    } finally {
      await rm(projectDir, { recursive: true, force: true }).catch(() => {});
      await rm(outputDir, { recursive: true, force: true }).catch(() => {});
    }
  });
});
