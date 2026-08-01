/**
 * Teste da normalização de quadro (server/frame-fit.ts) sobre o decodificador
 * único do projeto (decodePngToRgba, em server/png.ts).
 *
 * O que estes testes protegem:
 *   1. a bbox de alfa acha o sprite e devolve null no quadro vazio;
 *   2. o recorte é UM SÓ para todos os quadros — é o que impede o personagem de
 *      mudar de tamanho ao girar, e é o erro mais fácil de cometer aqui;
 *   3. o quadro de saída tem exatamente o tamanho pedido;
 *   4. o PNG pago é copiado para raw/ ANTES de ser sobrescrito, e uma segunda
 *      passada não destrói essa cópia;
 *   5. o decodificador de `png.ts` desfaz os cinco tipos de filtro do PNG —
 *      png.test.ts cobre o que ESTE projeto escreve (filtro 0); PNG que vem da
 *      PixelLab usa filtro adaptativo, e é esse caminho que o teste aqui fixa.
 *
 * Execute com: node --test server/frame-fit.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { crc32, deflateSync } from 'node:zlib';
import { encodePngFromRgba, PngDecodeError } from './png.ts';
import {
  alphaBBox,
  decode,
  fitFrames,
  fitFramesOnDisk,
  squareRect,
  unionRect,
  type Rect,
} from './frame-fit.ts';

// ------------------------------------------------------------------ fixtures

/** Imagem RGBA transparente com um retângulo opaco dentro. */
function spriteRgba(size: number, rect: Rect, color = 200): Buffer {
  const rgba = Buffer.alloc(size * size * 4);
  for (let y = rect.y; y < rect.y + rect.height; y += 1) {
    for (let x = rect.x; x < rect.x + rect.width; x += 1) {
      const i = (y * size + x) * 4;
      rgba[i] = color;
      rgba[i + 1] = color;
      rgba[i + 2] = color;
      rgba[i + 3] = 255;
    }
  }
  return rgba;
}

function spritePng(size: number, rect: Rect, color = 200): Buffer {
  return encodePngFromRgba(spriteRgba(size, rect, color), size, size);
}

function tmpDir(): string {
  const dir = join(tmpdir(), `frame-fit-${randomBytes(4).toString('hex')}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

// ------------------------------------------------------------------ bbox

test('alphaBBox acha o retângulo opaco e ignora o transparente', () => {
  const img = decode(spritePng(32, { x: 3, y: 4, width: 5, height: 6 }));
  assert.deepEqual(alphaBBox(img), { x: 3, y: 4, width: 5, height: 6 });
});

test('alphaBBox devolve null quando tudo é transparente', () => {
  const img = decode(encodePngFromRgba(Buffer.alloc(16 * 16 * 4), 16, 16));
  assert.equal(alphaBBox(img), null);
});

test('unionRect cobre todos os retângulos', () => {
  assert.deepEqual(
    unionRect([
      { x: 10, y: 5, width: 11, height: 26 },
      { x: 14, y: 6, width: 5, height: 26 },
    ]),
    { x: 10, y: 5, width: 11, height: 27 },
  );
});

test('squareRect cresce o lado menor centrando, e pode sair da moldura', () => {
  assert.deepEqual(squareRect({ x: 10, y: 5, width: 11, height: 27 }), {
    x: 2,
    y: 5,
    width: 27,
    height: 27,
  });
});

// ------------------------------------------------------------------ fit

test('fitFrames devolve todos os quadros no tamanho pedido', () => {
  const pngs = [
    spritePng(64, { x: 20, y: 10, width: 20, height: 40 }),
    spritePng(64, { x: 26, y: 12, width: 8, height: 38 }),
  ];
  const { images, rect } = fitFrames(pngs, { size: 32 });
  assert.equal(images.length, 2);
  assert.ok(rect);
  for (const png of images) {
    const img = decode(png);
    assert.equal(img.width, 32);
    assert.equal(img.height, 32);
  }
});

test('o recorte é o MESMO para todos os quadros — o personagem não muda de tamanho ao girar', () => {
  // Sul largo, sudeste estreito: exatamente a diferença que o v3 produz.
  const sul = spritePng(64, { x: 20, y: 10, width: 20, height: 40 });
  const sudeste = spritePng(64, { x: 26, y: 10, width: 10, height: 40 });

  const { rect, images } = fitFrames([sul, sudeste], { size: 40 });

  // União: x 20..40 (20 de largura), y 10..50 (40 de altura) → quadrado de 40.
  assert.deepEqual(rect, { x: 10, y: 10, width: 40, height: 40 });

  const a = alphaBBox(decode(images[0]!))!;
  const b = alphaBBox(decode(images[1]!))!;
  // A razão de larguras 20:10 sobrevive ao recorte. Se cada quadro tivesse
  // recebido a bbox própria, as duas sairiam com a MESMA largura — que é
  // justamente o bug.
  assert.ok(
    Math.abs(a.width / b.width - 2) < 0.25,
    `esperava razão ~2 entre as larguras, veio ${a.width}/${b.width}`,
  );
  assert.equal(a.height, b.height, 'mesma altura: mesma escala nas duas direções');
});

test('quadro que era 66% da altura passa a preencher a moldura', () => {
  // Reproduz a medição real: sprite de 113 px de altura num quadro de 172.
  const antes = spritePng(172, { x: 40, y: 29, width: 95, height: 113 });
  const bboxAntes = alphaBBox(decode(antes))!;
  assert.ok(bboxAntes.height / 172 < 0.7, 'a fixture reproduz o quadro estufado');

  const { images } = fitFrames([antes], { size: 128 });
  const depois = decode(images[0]!);
  const bboxDepois = alphaBBox(depois)!;
  assert.equal(depois.height, 128);
  assert.ok(
    bboxDepois.height / 128 > 0.97,
    `esperava a altura preenchida, veio ${bboxDepois.height}/128`,
  );
});

test('todos os quadros transparentes: os bytes originais voltam intactos', () => {
  const vazio = encodePngFromRgba(Buffer.alloc(16 * 16 * 4), 16, 16);
  const { images, rect } = fitFrames([vazio, vazio], { size: 8 });
  assert.equal(rect, null);
  assert.equal(images[0], vazio);
});

test('margem reserva folga dentro do quadro final', () => {
  const png = spritePng(64, { x: 10, y: 10, width: 40, height: 40 });
  const { images } = fitFrames([png], { size: 32, margin: 4 });
  const bbox = alphaBBox(decode(images[0]!))!;
  assert.equal(bbox.x, 4);
  assert.equal(bbox.width, 24, '32 menos 4 de cada lado');
});

test('margem que não cabe no quadro é erro explícito', () => {
  const png = spritePng(64, { x: 10, y: 10, width: 40, height: 40 });
  assert.throws(() => fitFrames([png], { size: 8, margin: 4 }), /margem/);
});

// ------------------------------------------------------------------ disco

test('fitFramesOnDisk guarda o PNG pago em raw/ antes de sobrescrever', async () => {
  const dir = tmpDir();
  try {
    const nomes = ['south-00.png', 'east-00.png'];
    const originais = [
      spritePng(64, { x: 20, y: 10, width: 20, height: 40 }),
      spritePng(64, { x: 26, y: 12, width: 8, height: 38 }),
    ];
    const paths = nomes.map((n, i) => {
      const p = join(dir, n);
      writeFileSync(p, originais[i]!);
      return p;
    });

    await fitFramesOnDisk(paths, { size: 32 });

    for (let i = 0; i < paths.length; i += 1) {
      const raw = readFileSync(join(dir, 'raw', nomes[i]!));
      assert.deepEqual(raw, originais[i], 'raw/ tem o PNG pago, byte a byte');
      assert.equal(decode(readFileSync(paths[i]!)).width, 32, 'o arquivo público foi recortado');
    }

    // Segunda passada: o recorte parte do raw/, não do arquivo já recortado, e
    // a cópia crua não é sobrescrita. Sem isso, rodar duas vezes recortaria o
    // recorte e o personagem encolheria a cada execução.
    await fitFramesOnDisk(paths, { size: 32 });
    assert.deepEqual(readFileSync(join(dir, 'raw', nomes[0]!)), originais[0]);
    assert.equal(decode(readFileSync(paths[0]!)).width, 32);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('fitFramesOnDisk com lista vazia não faz nada', async () => {
  const r = await fitFramesOnDisk([], { size: 32 });
  assert.deepEqual(r, { images: [], rect: null });
});

// ------------------------------------------------------------------ decoder

test('decodePngToRgba desfaz os cinco tipos de filtro', () => {
  // Uma imagem RGBA 4×5 em que CADA linha usa um filtro diferente. PNGs reais
  // da PixelLab usam filtro adaptativo; um decodificador que só entende o
  // filtro 0 (o único que png.ts escreve) passaria no round-trip e falharia
  // no arquivo de verdade.
  const w = 4;
  const h = 5;
  const stride = w * 4;
  const esperado = Buffer.alloc(w * h * 4);
  for (let i = 0; i < esperado.length; i += 1) esperado[i] = (i * 7 + 3) & 0xff;

  const raw: number[] = [];
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y += 1) {
    const filtro = y; // 0,1,2,3,4
    const linha = esperado.subarray(y * stride, (y + 1) * stride);
    raw.push(filtro);
    for (let i = 0; i < stride; i += 1) {
      const a = i >= 4 ? linha[i - 4]! : 0;
      const b = prev[i]!;
      const c = i >= 4 ? prev[i - 4]! : 0;
      let pred = 0;
      if (filtro === 1) pred = a;
      else if (filtro === 2) pred = b;
      else if (filtro === 3) pred = (a + b) >> 1;
      else if (filtro === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      raw.push((linha[i]! - pred) & 0xff);
    }
    prev = Buffer.from(linha);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const chunk = (tipo: string, data: Buffer): Buffer => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const corpo = Buffer.concat([Buffer.from(tipo, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(corpo) >>> 0, 0);
    return Buffer.concat([len, corpo, crc]);
  };
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.from(raw))),
    chunk('IEND', Buffer.alloc(0)),
  ]);

  assert.deepEqual(decode(png).rgba, esperado);
});

test('decodePngToRgba recusa o que não sabe ler em vez de inventar pixels', () => {
  assert.throws(() => decode(Buffer.from('não sou png')), PngDecodeError);
});

test('round-trip: encodePngFromRgba → decodePngToRgba preserva os pixels', () => {
  const rgba = spriteRgba(24, { x: 2, y: 3, width: 9, height: 11 }, 137);
  const voltou = decode(encodePngFromRgba(rgba, 24, 24));
  assert.deepEqual(voltou.rgba, rgba);
});
