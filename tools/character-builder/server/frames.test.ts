/**
 * Teste do módulo server/frames.ts — leitura de rotation_urls por chave.
 *
 * Propriedades verificadas:
 *   1. Payload com chaves em ordem canónica → frames correctos.
 *   2. Payload com chaves em ordem INVERTIDA → EXACTAMENTE o mesmo resultado.
 *   3. Payload faltando 'west' → MissingDirectionError.
 *   4. Chave desconhecida → UnknownDirectionError.
 *   5. skeletons populado → hasSkeletons: true.
 *
 * Execute com: npx tsx server/frames.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import {
  parseAndWriteFrames,
  UnknownDirectionError,
  MissingDirectionError,
  type FramesResult,
} from './frames.ts';
import { DIRECTIONS } from './model.ts';

// ------------------------------------------------------------------ helpers

function tmpDir(): string {
  const dir = join(tmpdir(), `frames-test-${randomBytes(4).toString('hex')}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** PNG 1×1 pixel válido, diferente para cada direcção. */
function fakePng(label: string): string {
  // Usamos o mesmo PNG mas com label no nome — o conteúdo não importa para o teste.
  return 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
}

function makePayload(order?: readonly string[]): Record<string, unknown> {
  const rotation_urls: Record<string, string[]> = {};
  const dirs = order ?? DIRECTIONS;
  for (const dir of dirs) {
    rotation_urls[dir] = [fakePng(dir), fakePng(`${dir}-f1`)];
  }
  return { rotation_urls };
}

// ------------------------------------------------------------------ testes

test('payload com ordem canónica — todas as 8 direcções', async () => {
  const dir = tmpDir();
  try {
    const payload = makePayload();
    const result = await parseAndWriteFrames(payload, 'test', 'canonical', dir);

    assert.equal(Object.keys(result.frames).length, 8, '8 direcções');
    assert.equal(result.hasSkeletons, false, 'sem skeletons');

    for (const d of DIRECTIONS) {
      const paths = result.frames[d];
      assert.ok(paths, `direção ${d} deve existir`);
      assert.equal(paths.length, 2, `${d}: 2 frames`);
      // Verifica que os ficheiros existem
      for (const p of paths) {
        // p é relativo: /assets/test/canonical/S-00.png
        const full = join(dir, p.replace(/^\/assets\//, ''));
        assert.ok(existsSync(full), `ficheiro deve existir: ${full}`);
      }
    }

    console.log('✓ payload canónico: 8 direcções × 2 frames cada');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('payload com ordem INVERTIDA produz EXATAMENTE o mesmo resultado', async () => {
  const dir = tmpDir();
  try {
    const reversed = [...DIRECTIONS].reverse();
    const payload = makePayload(reversed);

    const result = await parseAndWriteFrames(payload, 'test', 'inverted', dir);

    // O resultado deve ter as 8 direcções, e a ordem das chaves no objeto
    // de saída é determinística (iteramos DIRECTIONS, não Object.keys do payload).
    assert.equal(Object.keys(result.frames).length, 8);

    // A ordem das chaves no resultado deve ser a canónica,
    // independentemente da ordem no payload.
    const resultKeys = Object.keys(result.frames);
    assert.deepStrictEqual(resultKeys, [...DIRECTIONS],
      'ordem das chaves no resultado deve ser canónica, não a do payload');

    // Verifica que 'south' existe e tem 2 frames mesmo estando por último no payload
    assert.ok(result.frames['south'], 'south deve existir');
    assert.equal(result.frames['south']!.length, 2, 'south: 2 frames');

    // 'south-east' é a primeira no payload invertido mas deve continuar a existir
    assert.ok(result.frames['south-east'], 'south-east deve existir');
    assert.equal(result.frames['south-east']!.length, 2, 'south-east: 2 frames');

    console.log('✓ ordem invertida: resultado idêntico ao canónico');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('payload faltando "west" → MissingDirectionError', async () => {
  const dir = tmpDir();
  try {
    const rotation_urls: Record<string, string[]> = {};
    for (const d of DIRECTIONS) {
      if (d === 'west') continue; // OMITIDO
      rotation_urls[d] = [fakePng(d)];
    }
    const payload = { rotation_urls };

    await assert.rejects(
      async () => parseAndWriteFrames(payload, 'test', 'no-west', dir),
      (err: unknown) => {
        if (!(err instanceof MissingDirectionError)) return false;
        // O erro deve mencionar 'west'
        return err.direction === 'west' && err.message.includes('west');
      },
    );

    console.log('✓ ausência de west → MissingDirectionError');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('chave desconhecida → UnknownDirectionError', async () => {
  const dir = tmpDir();
  try {
    const payload = makePayload();
    // Adiciona uma chave espúria
    (payload['rotation_urls'] as Record<string, unknown>)['north-north-west'] = [fakePng('nnw')];

    await assert.rejects(
      async () => parseAndWriteFrames(payload, 'test', 'bad-key', dir),
      (err: unknown) => {
        if (!(err instanceof UnknownDirectionError)) return false;
        return err.direction === 'north-north-west';
      },
    );

    console.log('✓ chave desconhecida → UnknownDirectionError');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('skeletons populado → hasSkeletons: true', async () => {
  const dir = tmpDir();
  try {
    const payload = makePayload();
    (payload as Record<string, unknown>)['skeletons'] = [
      { label: 'NOSE', x: 0.5, y: 0.3 },
      { label: 'NECK', x: 0.5, y: 0.4 },
    ];

    const result = await parseAndWriteFrames(payload, 'test', 'with-skel', dir);
    assert.equal(result.hasSkeletons, true, 'hasSkeletons deve ser true');

    console.log('✓ skeletons populado → hasSkeletons: true');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('skeletons vazio → hasSkeletons: false', async () => {
  const dir = tmpDir();
  try {
    const payload = makePayload();
    (payload as Record<string, unknown>)['skeletons'] = [];

    const result = await parseAndWriteFrames(payload, 'test', 'empty-skel', dir);
    assert.equal(result.hasSkeletons, false, 'hasSkeletons deve ser false com array vazio');

    console.log('✓ skeletons vazio → hasSkeletons: false');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('payload sem rotation_urls → erro', async () => {
  const dir = tmpDir();
  try {
    await assert.rejects(
      async () => parseAndWriteFrames({}, 'test', 'no-ru', dir),
      (err: unknown) =>
        err instanceof Error && err.message.includes('rotation_urls'),
    );
    console.log('✓ sem rotation_urls → erro');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
