/**
 * Teste do molde do cubo — o init_image que abre toda geração de bloco.
 *
 * O que está travado:
 *   1. O molde é DETERMINÍSTICO: duas renderizações são byte a byte iguais
 *      (ele entra no request e no raciocínio de custo — um molde que muda
 *      mudaria o artefato sem ninguém pedir).
 *   2. O PNG declara exatamente o bounding box do cubo canônico.
 *   3. `blockImageSize` devolve o mesmo bounding box, e é ele que vai como
 *      image_size ao endpoint.
 *
 * Execute com: node --test server/cube-mould.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CANONICAL_CUBE } from '../../../packages/iso-core/src/iso-cube.ts';
import { BLOCK_GEOMETRY, blockImageSize, mouldBase64, renderMouldPng } from './cube-mould.ts';
import { readPngHeader } from './png.ts';

test('o molde é determinístico — duas renderizações, os mesmos bytes', () => {
  const a = renderMouldPng();
  const b = renderMouldPng();
  assert.ok(a.equals(b));
  assert.equal(mouldBase64(), a.toString('base64'));
});

test('o PNG do molde tem o bounding box exato do cubo canônico', () => {
  const head = readPngHeader(renderMouldPng());
  assert.equal(head.width, CANONICAL_CUBE.spriteWidth);
  assert.equal(head.height, CANONICAL_CUBE.spriteHeight);
});

test('blockImageSize é o bounding box do cubo — o canvas que o molde preenche', () => {
  assert.deepEqual(blockImageSize(), {
    width: BLOCK_GEOMETRY.spriteWidth,
    height: BLOCK_GEOMETRY.spriteHeight,
  });
});

test('a geometria do bloco É a canônica — uma forma só em todo lugar', () => {
  assert.equal(BLOCK_GEOMETRY, CANONICAL_CUBE);
});
