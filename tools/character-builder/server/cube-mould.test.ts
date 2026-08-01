/**
 * Teste do molde do cubo e da sua ligação com a geração.
 *
 * O teste mais importante deste arquivo não é sobre desenho: é o que prova que
 * o hash dos blocos **já pagos** não mudou. Os três hashes conferidos abaixo
 * foram lidos dos manifestos em disco de gerações reais — não são valores que
 * eu escolhi para o teste passar. Se uma refatoração futura quebrar essa
 * igualdade, o efeito prático é o editor pagar de novo por arte que já existe.
 *
 * Execute com: node --test server/cube-mould.test.ts
 */
import { test } from 'node:test';
import { crc32, deflateSync } from 'node:zlib';
import assert from 'node:assert/strict';
import {
  BLOCK_GEOMETRY,
  blockImageSize,
  mouldBase64,
  normalizeBlockPng,
  normalizeBlockRgba,
  renderMouldPng,
  resolveReference,
} from './cube-mould.ts';
import { decodePngToRgba, encodePngFromRgba, isPng, readPngHeader } from './png.ts';
import { worldBlockHash, type WorldBlockConfig } from './world-block.ts';

// ------------------------------------------------------------------ o molde

test('o molde é um PNG do tamanho canônico', () => {
  const png = renderMouldPng();
  assert.ok(isPng(png));
  const head = readPngHeader(png);
  assert.equal(head.width, BLOCK_GEOMETRY.spriteWidth);
  assert.equal(head.height, BLOCK_GEOMETRY.spriteHeight);
  assert.equal(head.colorType, 6);
  assert.equal(head.bitDepth, 8);
});

test('o molde é determinístico — a mesma referência em toda geração', () => {
  assert.deepEqual(renderMouldPng(), renderMouldPng());
  assert.equal(mouldBase64(), renderMouldPng().toString('base64'));
});

test('image_size é o bounding box do cubo, e cabe na faixa do endpoint', () => {
  const size = blockImageSize();
  assert.deepEqual(size, { width: 48, height: 53 });
  for (const v of [size.width, size.height]) {
    assert.ok(v >= 16 && v <= 64, `${v} fora de 16–64`);
  }
});

test('o molde vai e volta pelo codec sem perder um pixel', () => {
  const png = renderMouldPng();
  const back = decodePngToRgba(png);
  assert.equal(back.width, 48);
  assert.equal(back.height, 53);
  const again = encodePngFromRgba(back.data, back.width, back.height);
  assert.deepEqual(again, png);
});

// ------------------------------------------------------------------ referência

test('sem referência do usuário, entra o molde', () => {
  const r = resolveReference(undefined);
  assert.equal(r.source, 'molde');
  assert.equal(r.recusa, '');
  assert.equal(r.base64, mouldBase64());
});

test('referência na proporção canônica substitui o molde', () => {
  // 96×106 é o molde em escala 2× — mesma razão, tamanho diferente.
  const png = encodePngFromRgba(Buffer.alloc(96 * 106 * 4, 200), 96, 106);
  const r = resolveReference(png);
  assert.equal(r.source, 'usuario');
  assert.equal(r.width, 96);
  assert.equal(r.height, 106);
  assert.equal(r.recusa, '');
});

test('referência quadrada é recusada, com motivo, e cai no molde', () => {
  const png = encodePngFromRgba(Buffer.alloc(48 * 48 * 4, 200), 48, 48);
  const r = resolveReference(png);
  assert.equal(r.source, 'molde');
  assert.match(r.recusa, /48×48/);
  assert.match(r.recusa, /molde do projeto/);
});

test('referência que não é PNG cai no molde sem explodir', () => {
  const r = resolveReference(Buffer.from('isto não é uma imagem'));
  assert.equal(r.source, 'molde');
  assert.match(r.recusa, /não pôde ser lida/);
});

// ------------------------------------------------------------------ normalização

test('normalizar o próprio molde não muda nada', () => {
  const { png, report } = normalizeBlockPng(renderMouldPng());
  assert.equal(report.coverage, 1);
  assert.equal(report.offsetX, 0);
  assert.equal(report.offsetY, 0);
  assert.deepEqual(png, renderMouldPng());
});

test('normalizar pixels crus dá o mesmo que normalizar o PNG deles', () => {
  const decoded = decodePngToRgba(renderMouldPng());
  const cru = normalizeBlockRgba(decoded.data, decoded.width, decoded.height);
  const doPng = normalizeBlockPng(renderMouldPng());
  assert.deepEqual(cru.png, doPng.png);
});

// ------------------------------------------------------------------ o codec

test('o decodificador aceita RGB sem alfa e o trata como opaco', () => {
  // Tipo de cor 2 (RGB) montado à mão: é o que um PNG de fora pode ser.
  const rgb = Buffer.from([10, 20, 30, 40, 50, 60]);
  const png = pngRgb(rgb, 2, 1);
  const back = decodePngToRgba(png);
  assert.deepEqual(Array.from(back.data), [10, 20, 30, 255, 40, 50, 60, 255]);
});

test('o decodificador recusa o que está fora do escopo, dizendo o quê', () => {
  assert.throws(() => decodePngToRgba(Buffer.from('nada disso')), /assinatura PNG/);
});

// ------------------------------------------------------------------ hash pago

test('hash legado é IDÊNTICO ao dos blocos já pagos em disco', () => {
  // Lidos de tools/character-builder/assets/world-blocks/*/block.json.
  const pagos: ReadonlyArray<[string, WorldBlockConfig]> = [
    [
      '4bd758088576e690',
      { description: 'green grass on top of brown dirt', size: 48, shape: 'block', seed: 1234, facingMode: 'uniform', geometry: 'legado' },
    ],
    [
      '63e037cbf11f6721',
      { description: 'yellow desert sand', size: 48, shape: 'block', seed: 2002, facingMode: 'uniform', geometry: 'legado' },
    ],
    [
      '6c218af3603f1187',
      { description: 'mossy cobblestone path block', size: 48, shape: 'block', seed: 7777, facingMode: 'uniform', geometry: 'legado' },
    ],
  ];
  for (const [esperado, config] of pagos) {
    assert.equal(worldBlockHash(config), esperado, `hash de "${config.description}"`);
  }
});

test('a geometria canônica tem namespace de cache próprio', () => {
  const base: WorldBlockConfig = { description: 'pedra', size: 48 };
  const legado = worldBlockHash({ ...base, geometry: 'legado' });
  const canonica = worldBlockHash({ ...base, geometry: 'canonica' });
  assert.notEqual(legado, canonica);
  // O default é a canônica.
  assert.equal(worldBlockHash(base), canonica);
});

test('a referência entra no hash pelo conteúdo, não pela identidade', () => {
  const base: WorldBlockConfig = { description: 'pedra', size: 48 };
  const ref = encodePngFromRgba(Buffer.alloc(48 * 53 * 4, 7), 48, 53).toString('base64');
  const a = worldBlockHash({ ...base, referencePngB64: ref });
  const b = worldBlockHash({ ...base, referencePngB64: `${ref}` });
  assert.equal(a, b, 'mesma referência, mesmo cache');
  assert.notEqual(a, worldBlockHash(base), 'referência diferente, cache diferente');
});

test('a força do init_image entra no hash — mudar a força é outra arte', () => {
  const base: WorldBlockConfig = { description: 'pedra', size: 48 };
  assert.notEqual(
    worldBlockHash({ ...base, initImageStrength: 300 }),
    worldBlockHash({ ...base, initImageStrength: 480 }),
  );
});

// ------------------------------------------------------------------ auxiliares

/** PNG tipo 2 (RGB, 8 bits) montado à mão, para testar o decodificador. */
function pngRgb(rgb: Buffer, width: number, height: number): Buffer {
  const chunk = (type: string, data: Buffer): Buffer => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const t = Buffer.from(type, 'ascii');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([t, data])) >>> 0, 0);
    return Buffer.concat([len, t, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const stride = width * 3;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y += 1) rgb.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
