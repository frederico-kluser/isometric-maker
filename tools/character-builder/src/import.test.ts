/**
 * Testes de validação local do importador de arte-base.
 *
 * Cobre todas as 5 regras de rejeição + o caminho feliz.
 * Gera PNGs sintéticos em memória — sem dependência de arquivos externos.
 *
 * Execute com: npx tsx src/import.test.ts
 */

import { deflateSync } from 'node:zlib';
import { validateImport, type ImportResult } from './import.ts';

// =====================================================================
// helpers — geração de PNG sintético
// =====================================================================

/** CRC32 para os chunks PNG. Tabela pré-calculada. */
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) {
    c = CRC_TABLE[(c ^ b)! & 0xff]! ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[i] = c;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crcIn = Buffer.concat([t, data]);
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc32(crcIn), 0);
  return Buffer.concat([len, t, data, c]);
}

function pngSignature(): Buffer {
  return Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
}

/**
 * Cria um PNG RGB 8bpc válido com as dimensões dadas.
 * Todos os pixels são pretos (R=0 G=0 B=0) — o conteúdo visual não importa
 * para a validação de dimensões.
 */
function makePNG(width: number, height: number): Buffer {
  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // colour type RGB
  // bytes 10-12: compression=0, filter=0, interlace=0

  // IDAT — pixels pretos, linha a linha (1 byte filter + 3*width bytes RGB)
  const rowLen = 1 + width * 3;
  const raw = Buffer.alloc(height * rowLen, 0);
  const compressed = deflateSync(raw);

  return Buffer.concat([
    pngSignature(),
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Converte um Buffer para ArrayBuffer (rejeita SharedArrayBuffer). */
function toArrayBuffer(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

/** Afirma que o resultado é erro e devolve a mensagem (estreita o tipo). */
function assertErr(r: ImportResult, msg: string): string {
  if (r.ok) throw new Error(msg);
  return r.error;
}

// =====================================================================
// runner mínimo (sem framework)
// =====================================================================

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    passed += 1;
  } catch (err) {
    failed += 1;
    console.error(`✕ ${name}`);
    console.error(`  ${err instanceof Error ? err.message : String(err)}`);
  }
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

// =====================================================================
// casos de teste
// =====================================================================

// --- rejeição: não-PNG -----------------------------------------------

test('rejeita buffer que não é PNG (poucos bytes)', () => {
  const buf = new ArrayBuffer(4);
  const r = validateImport(buf, 32);
  const msg = assertErr(r, 'deveria rejeitar');
  assert(msg.length > 0, 'mensagem de erro não pode ser vazia');
});

test('rejeita buffer com assinatura errada', () => {
  const buf = toArrayBuffer(Buffer.alloc(100, 0x41)); // 'A' * 100
  const r = validateImport(buf, 32);
  assertErr(r, 'deveria rejeitar');
});

// --- rejeição: lado > 256 -------------------------------------------

test('rejeita largura > 256', () => {
  const buf = toArrayBuffer(makePNG(300, 64));
  const r = validateImport(buf, 32);
  const msg = assertErr(r, 'deveria rejeitar largura 300');
  assert(msg.length > 0, 'mensagem de erro não pode ser vazia');
});

test('rejeita altura > 256', () => {
  const buf = toArrayBuffer(makePNG(64, 257));
  const r = validateImport(buf, 32);
  assertErr(r, 'deveria rejeitar altura 257');
});

// --- rejeição: não quadrada (ausência) -------------------------------

test('rejeita imagem 65×64 (não quadrada)', () => {
  const buf = toArrayBuffer(makePNG(65, 64));
  const r = validateImport(buf, 32);
  assertErr(r, '65×64 deveria ser recusada por não ser quadrada');
});

test('rejeita imagem 64×65 (não quadrada)', () => {
  const buf = toArrayBuffer(makePNG(64, 65));
  const r = validateImport(buf, 32);
  assertErr(r, '64×65 deveria ser recusada');
});

// --- rejeição: lado fora de 32–256 -----------------------------------

test('rejeita largura = 257 (fora da faixa)', () => {
	const buf = toArrayBuffer(makePNG(257, 257));
	const r = validateImport(buf, 256);
	assertErr(r, '257×257 deveria ser recusada');
});

// --- rejeição: altura informada > altura da imagem -------------------

test('rejeita charHeight > imageHeight', () => {
  const buf = toArrayBuffer(makePNG(64, 64));
  const r = validateImport(buf, 65);
  assertErr(r, 'altura 65 > imagem 64 deveria recusar');
});

test('rejeita charHeight = imageHeight + 1', () => {
  const buf = toArrayBuffer(makePNG(32, 32));
  const r = validateImport(buf, 33);
  assertErr(r, 'altura 33 > imagem 32 deveria recusar');
});

// --- caminho feliz ---------------------------------------------------

test('aceita PNG 64×64 com altura válida', () => {
  const buf = toArrayBuffer(makePNG(64, 64));
  const r = validateImport(buf, 48);
  assert(r.ok === true, '64×64 com altura 48 deveria passar');
  if (r.ok) {
    assert(r.width === 64, `width=${r.width} deveria ser 64`);
    assert(r.height === 64, `height=${r.height} deveria ser 64`);
    assert(r.charHeight === 48, `charHeight=${r.charHeight} deveria ser 48`);
  }
});

test('aceita PNG 128×128 com altura igual à imagem', () => {
  const buf = toArrayBuffer(makePNG(128, 128));
  const r = validateImport(buf, 128);
  assert(r.ok === true, '128×128 com altura 128 deveria passar');
});

test('aceita PNG 32×32 no limite inferior', () => {
	const buf = toArrayBuffer(makePNG(32, 32));
	const r = validateImport(buf, 32);
	assert(r.ok === true, '32×32 com altura 32 deveria passar');
});

test('aceita PNG 32×32 com altura zero (base no chão)', () => {
  const buf = toArrayBuffer(makePNG(32, 32));
  const r = validateImport(buf, 0);
  assert(r.ok === true, '32×32 com altura 0 deveria passar');
});

// =====================================================================
// relatório
// =====================================================================

const total = passed + failed;
console.log(`${passed}/${total} passou`);
if (failed > 0) {
  console.error(`${failed} falha(s)`);
  process.exit(1);
}
