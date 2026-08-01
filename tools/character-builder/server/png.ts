/**
 * Codificador PNG mínimo, para pixels RGBA crus.
 *
 * ## Por que isto existe
 *
 * `/create-isometric-tile` não devolve um arquivo PNG. Devolve os **pixels RGBA
 * crus** codificados em base64 — verificado contra a API em 2026-08-01: um tile
 * 48×48 chega com exatamente 9216 bytes, que é 48 × 48 × 4, e os bytes começam
 * em `00 00 00 00` em vez da assinatura `89 50 4E 47`.
 *
 * Gravar isso num arquivo `.png` produz um arquivo que nenhum navegador abre —
 * e o pior é que a geração foi paga e o erro só aparece na hora de desenhar.
 * Os endpoints de personagem não têm esse problema porque entregam URLs de PNGs
 * de verdade; a diferença é por endpoint, não por API.
 *
 * ## Escopo deliberadamente pequeno
 *
 * 8 bits por canal, RGBA, sem entrelaçamento, filtro 0 (None) em toda scanline.
 * Nada de paleta, nada de filtro adaptativo. Pixel art nesse tamanho comprime
 * bem sem filtro, e cada opção a mais é uma forma a mais de gerar arquivo
 * inválido. Se um dia precisar de mais, o teste de ida e volta aqui é o que
 * mantém honesto.
 */
import { crc32, deflateSync, inflateSync } from 'node:zlib';

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

/** Um chunk PNG: comprimento, tipo, dados e CRC de (tipo + dados). */
function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])) >>> 0, 0);
  return Buffer.concat([length, typeBuf, data, crc]);
}

/** A imagem não tem o tamanho que os bytes dizem. */
export class RgbaSizeError extends Error {
  constructor(byteLength: number, width: number, height: number) {
    super(
      `os bytes não fecham com o tamanho declarado: ${byteLength} bytes para ` +
        `${width}×${height} RGBA (esperado ${width * height * 4}). ` +
        'A geração foi paga — confira o image_size enviado antes de gerar de novo.',
    );
    this.name = 'RgbaSizeError';
  }
}

/**
 * Codifica pixels RGBA crus (linha a linha, do topo) num arquivo PNG.
 *
 * @param rgba - `width × height × 4` bytes, na ordem R, G, B, A.
 */
export function encodePngFromRgba(
  rgba: Buffer,
  width: number,
  height: number,
): Buffer {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error(`dimensões inválidas para PNG: ${width}×${height}`);
  }
  if (rgba.length !== width * height * 4) {
    throw new RgbaSizeError(rgba.length, width, height);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // profundidade de bits
  ihdr[9] = 6; // tipo de cor 6 = RGBA
  ihdr[10] = 0; // compressão (deflate, o único valor válido)
  ihdr[11] = 0; // método de filtro (0, o único valor válido)
  ihdr[12] = 0; // sem entrelaçamento

  // Cada scanline é precedida por um byte de filtro. 0 = None.
  const stride = width * 4;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** true quando o buffer começa com a assinatura PNG. */
export function isPng(buf: Buffer): boolean {
  return buf.length >= 8 && buf.subarray(0, 8).equals(SIGNATURE);
}

/**
 * Normaliza o que um endpoint devolveu para bytes de PNG.
 *
 * Já é PNG → passa direto. É RGBA cru do tamanho esperado → codifica. Qualquer
 * outra coisa é erro nomeado, porque escrever bytes desconhecidos num `.png` é
 * exatamente como se perde uma geração já paga sem perceber.
 */
export function toPngBytes(
  data: Buffer,
  width: number,
  height: number,
): Buffer {
  if (isPng(data)) return data;
  return encodePngFromRgba(data, width, height);
}

// ---------------------------------------------------------------- leitura

export class PngDecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PngDecodeError';
  }
}

/** Percorre os chunks de um PNG. Não valida CRC — quem escreveu fomos nós. */
function* chunks(buf: Buffer): Generator<{ type: string; data: Buffer }> {
  let pos = 8;
  while (pos + 8 <= buf.length) {
    const length = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    yield { type, data: buf.subarray(pos + 8, pos + 8 + length) };
    pos += 12 + length;
  }
}

export interface PngHeader {
  readonly width: number;
  readonly height: number;
  readonly bitDepth: number;
  readonly colorType: number;
  readonly interlace: number;
}

/**
 * Lê só o cabeçalho.
 *
 * É o suficiente para validar a proporção de uma referência mandada pelo
 * usuário — e validar proporção não precisa descomprimir 60 KB de pixels.
 */
export function readPngHeader(buf: Buffer): PngHeader {
  if (!isPng(buf)) throw new PngDecodeError('os bytes não começam com a assinatura PNG.');
  for (const c of chunks(buf)) {
    if (c.type !== 'IHDR') continue;
    return {
      width: c.data.readUInt32BE(0),
      height: c.data.readUInt32BE(4),
      bitDepth: c.data[8]!,
      colorType: c.data[9]!,
      interlace: c.data[12]!,
    };
  }
  throw new PngDecodeError('PNG sem chunk IHDR.');
}

/** Preditor de Paeth, do próprio spec do PNG. */
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** Canais por tipo de cor do PNG. Paleta (3) fica de fora, ver abaixo. */
const CHANNELS: Readonly<Record<number, number>> = { 0: 1, 2: 3, 4: 2, 6: 4 };

/**
 * Decodifica um PNG de 8 bits em pixels RGBA.
 *
 * Cobre os quatro tipos de cor que não precisam de tabela — cinza (0), RGB (2),
 * cinza+alfa (4) e RGBA (6) —, 8 bits por canal, sem entrelaçamento. Paleta
 * (tipo 3) fica de fora porque exigiria ler PLTE e tRNS, e nada neste projeto
 * grava PNG paletizado.
 *
 * Os cinco filtros de linha são todos tratados: um PNG legítimo pode usar
 * qualquer um, e o nosso codificador usar só o filtro 0 não diz nada sobre o
 * que vem de fora.
 */
export function decodePngToRgba(buf: Buffer): {
  width: number;
  height: number;
  data: Buffer;
} {
  const head = readPngHeader(buf);
  const channels = CHANNELS[head.colorType];
  if (head.bitDepth !== 8 || channels === undefined || head.interlace !== 0) {
    throw new PngDecodeError(
      `PNG fora do escopo suportado: profundidade ${head.bitDepth}, ` +
        `tipo de cor ${head.colorType}, entrelaçamento ${head.interlace}. ` +
        'Este decodificador cobre 8 bits, sem entrelaçamento, nos tipos 0, 2, 4 e 6.',
    );
  }

  const parts: Buffer[] = [];
  for (const c of chunks(buf)) if (c.type === 'IDAT') parts.push(c.data);
  if (parts.length === 0) throw new PngDecodeError('PNG sem dados de imagem (IDAT).');

  const raw = inflateSync(Buffer.concat(parts));
  const { width, height } = head;
  const bpp = channels;
  const stride = width * bpp;
  if (raw.length < height * (stride + 1)) {
    throw new PngDecodeError(
      `dados insuficientes: ${raw.length} bytes para ${width}×${height} ` +
        `com ${channels} canal(is).`,
    );
  }

  const out = Buffer.alloc(width * height * 4);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)]!;
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i += 1) {
      const a = i >= bpp ? line[i - bpp]! : 0;
      const b = prev[i]!;
      const c = i >= bpp ? prev[i - bpp]! : 0;
      switch (filter) {
        case 0:
          break;
        case 1:
          line[i] = (line[i]! + a) & 255;
          break;
        case 2:
          line[i] = (line[i]! + b) & 255;
          break;
        case 3:
          line[i] = (line[i]! + ((a + b) >> 1)) & 255;
          break;
        case 4:
          line[i] = (line[i]! + paeth(a, b, c)) & 255;
          break;
        default:
          throw new PngDecodeError(`filtro de linha desconhecido: ${filter}`);
      }
    }
    // Expansão para RGBA. Sem canal alfa a imagem é inteiramente opaca — que é
    // o certo: transparência ausente não é transparência total.
    for (let x = 0; x < width; x += 1) {
      const s = x * bpp;
      const d = (y * width + x) * 4;
      if (channels === 4) {
        out[d] = line[s]!;
        out[d + 1] = line[s + 1]!;
        out[d + 2] = line[s + 2]!;
        out[d + 3] = line[s + 3]!;
      } else if (channels === 3) {
        out[d] = line[s]!;
        out[d + 1] = line[s + 1]!;
        out[d + 2] = line[s + 2]!;
        out[d + 3] = 255;
      } else if (channels === 2) {
        out[d] = line[s]!;
        out[d + 1] = line[s]!;
        out[d + 2] = line[s]!;
        out[d + 3] = line[s + 1]!;
      } else {
        out[d] = line[s]!;
        out[d + 1] = line[s]!;
        out[d + 2] = line[s]!;
        out[d + 3] = 255;
      }
    }
    prev = line;
  }

  return { width, height, data: out };
}
