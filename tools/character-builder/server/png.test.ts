/**
 * Teste do codificador PNG.
 *
 * A propriedade que importa é a ida e volta: os bytes que entram têm que sair
 * iguais depois de codificar e decodificar. Sem isso, "gerou um PNG" quer dizer
 * apenas "gerou um arquivo com assinatura PNG" — e foi assim que uma geração
 * paga virou 9216 bytes de RGBA cru dentro de um arquivo `.png` que navegador
 * nenhum abre.
 *
 * Execute com: node --test server/png.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crc32, inflateSync } from 'node:zlib';
import { encodePngFromRgba, isPng, toPngBytes, RgbaSizeError } from './png.ts';

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

/** RGBA determinístico: cada pixel carrega o próprio índice, para achar troca de ordem. */
function rgba(width: number, height: number): Buffer {
  const buf = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    buf[i * 4] = i % 256;
    buf[i * 4 + 1] = (i * 7) % 256;
    buf[i * 4 + 2] = (i * 13) % 256;
    buf[i * 4 + 3] = i % 3 === 0 ? 0 : 255;
  }
  return buf;
}

/** Lê os chunks na ordem em que aparecem. */
function chunks(png: Buffer): Array<{ type: string; data: Buffer }> {
  const out: Array<{ type: string; data: Buffer }> = [];
  let off = 8;
  while (off < png.length) {
    const len = png.readUInt32BE(off);
    const type = png.subarray(off + 4, off + 8).toString('ascii');
    out.push({ type, data: png.subarray(off + 8, off + 8 + len) });
    off += 12 + len;
  }
  return out;
}

test('produz assinatura PNG e a ordem de chunks IHDR → IDAT → IEND', () => {
  const png = encodePngFromRgba(rgba(8, 8), 8, 8);
  assert.deepEqual(png.subarray(0, 8), SIGNATURE);
  assert.deepEqual(
    chunks(png).map((c) => c.type),
    ['IHDR', 'IDAT', 'IEND'],
  );
});

test('IHDR declara tamanho, 8 bits e tipo de cor 6 (RGBA)', () => {
  const png = encodePngFromRgba(rgba(48, 48), 48, 48);
  const ihdr = chunks(png)[0]!.data;
  assert.equal(ihdr.readUInt32BE(0), 48, 'largura');
  assert.equal(ihdr.readUInt32BE(4), 48, 'altura');
  assert.equal(ihdr[8], 8, 'profundidade de bits');
  assert.equal(ihdr[9], 6, 'tipo de cor RGBA');
  assert.equal(ihdr[10], 0, 'compressão deflate');
  assert.equal(ihdr[11], 0, 'método de filtro 0');
  assert.equal(ihdr[12], 0, 'sem entrelaçamento');
});

test('IDAT descomprime de volta aos MESMOS pixels, linha a linha', () => {
  const width = 12;
  const height = 9;
  const src = rgba(width, height);
  const png = encodePngFromRgba(src, width, height);
  const idat = chunks(png).find((c) => c.type === 'IDAT')!.data;
  const raw = inflateSync(idat);

  const stride = width * 4;
  assert.equal(raw.length, height * (stride + 1), 'uma scanline + 1 byte de filtro por linha');
  for (let y = 0; y < height; y += 1) {
    assert.equal(raw[y * (stride + 1)], 0, `linha ${y}: filtro tem que ser 0 (None)`);
    assert.deepEqual(
      raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)),
      src.subarray(y * stride, (y + 1) * stride),
      `linha ${y} saiu diferente — pixel trocado de lugar`,
    );
  }
});

test('CRC de cada chunk é verificável (arquivo inválido é pior que erro)', () => {
  const png = encodePngFromRgba(rgba(4, 4), 4, 4);
  let off = 8;
  while (off < png.length) {
    const len = png.readUInt32BE(off);
    const typeAndData = png.subarray(off + 4, off + 8 + len);
    const stored = png.readUInt32BE(off + 8 + len);
    assert.equal(crc32(typeAndData) >>> 0, stored, 'CRC divergente');
    off += 12 + len;
  }
});

test('bytes que não fecham com o tamanho → RgbaSizeError que cita o pago', () => {
  assert.throws(
    () => encodePngFromRgba(rgba(8, 8), 16, 16),
    (err: unknown) => {
      assert.ok(err instanceof RgbaSizeError);
      assert.match(err.message, /esperado 1024/);
      assert.match(err.message, /paga/);
      return true;
    },
  );
});

test('dimensão inválida é erro, não arquivo silenciosamente quebrado', () => {
  assert.throws(() => encodePngFromRgba(Buffer.alloc(0), 0, 0), /dimensões inválidas/);
  assert.throws(() => encodePngFromRgba(rgba(4, 4), 4.5, 4), /dimensões inválidas/);
  assert.throws(() => encodePngFromRgba(rgba(4, 4), -4, 4), /dimensões inválidas/);
});

test('isPng distingue PNG de RGBA cru', () => {
  assert.equal(isPng(encodePngFromRgba(rgba(4, 4), 4, 4)), true);
  assert.equal(isPng(rgba(4, 4)), false, 'RGBA cru começa em 00 00 00 00');
  assert.equal(isPng(Buffer.alloc(3)), false, 'buffer curto demais não é PNG');
});

test('toPngBytes passa PNG adiante e codifica RGBA cru', () => {
  const already = encodePngFromRgba(rgba(4, 4), 4, 4);
  assert.equal(toPngBytes(already, 4, 4), already, 'PNG já pronto não é recodificado');

  const raw = rgba(4, 4);
  const encoded = toPngBytes(raw, 4, 4);
  assert.ok(isPng(encoded));
  assert.notEqual(encoded.length, raw.length);
});

test('o caso real do endpoint: 48×48 RGBA = 9216 bytes vira PNG válido', () => {
  // O tamanho exato que /create-isometric-tile devolveu em 2026-08-01.
  const raw = rgba(48, 48);
  assert.equal(raw.length, 9216, 'é este o número que denunciou o formato');
  const png = toPngBytes(raw, 48, 48);
  assert.ok(isPng(png));
  const ihdr = chunks(png)[0]!.data;
  assert.equal(ihdr.readUInt32BE(0), 48);
  assert.equal(ihdr.readUInt32BE(4), 48);
});
