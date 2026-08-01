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
import { crc32, deflateSync } from 'node:zlib';

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
