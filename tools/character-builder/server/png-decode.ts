/**
 * Decodificador PNG mínimo, para RGBA de 8 bits.
 *
 * ## Por que isto existe
 *
 * `png.ts` só codifica. Para recortar a margem transparente que o
 * `/create-character-v3` acrescenta ("Final canvas is padded ~2x for animation
 * room", spec vendorizado de 2026-08-01) é preciso LER os pixels de volta, e a
 * única alternativa seria uma dependência nativa de imagem — que este projeto
 * não tem e não quer, porque o pipeline inteiro roda `.ts` direto no Node 24
 * sem passo de build.
 *
 * ## Escopo deliberadamente pequeno
 *
 * Profundidade de 8 bits, sem entrelaçamento, tipos de cor 0 (cinza), 2 (RGB),
 * 3 (paleta), 4 (cinza+alfa) e 6 (RGBA). Tudo sai normalizado como RGBA de 8
 * bits, que é a forma que `encodePngFromRgba` já aceita — ida e volta fecha.
 *
 * O que NÃO é suportado falha com erro nomeado, nunca em silêncio: 16 bits por
 * canal e entrelaçamento Adam7. Decodificar errado um PNG já pago produz um
 * sprite corrompido que só aparece na tela, muito depois da cobrança.
 */
import { inflateSync } from 'node:zlib';

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

/** Canais por tipo de cor do PNG (tabela do IHDR). */
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

/** O buffer não é um PNG que este decodificador consiga ler. */
export class PngDecodeError extends Error {
  constructor(motivo: string) {
    super(`não deu para decodificar o PNG: ${motivo}`);
    this.name = 'PngDecodeError';
  }
}

/** Uma imagem decodificada: pixels RGBA de 8 bits, linha a linha, do topo. */
export interface DecodedPng {
  readonly width: number;
  readonly height: number;
  /** `width × height × 4` bytes, na ordem R, G, B, A. */
  readonly rgba: Buffer;
}

/** Desfaz o filtro de uma scanline no lugar. `prev` é a linha já desfiltrada. */
function unfilter(
  filterType: number,
  line: Buffer,
  prev: Buffer,
  bpp: number,
): void {
  switch (filterType) {
    case 0:
      return;
    case 1:
      for (let i = bpp; i < line.length; i += 1) {
        line[i] = (line[i]! + line[i - bpp]!) & 0xff;
      }
      return;
    case 2:
      for (let i = 0; i < line.length; i += 1) {
        line[i] = (line[i]! + prev[i]!) & 0xff;
      }
      return;
    case 3:
      for (let i = 0; i < line.length; i += 1) {
        const a = i >= bpp ? line[i - bpp]! : 0;
        line[i] = (line[i]! + ((a + prev[i]!) >> 1)) & 0xff;
      }
      return;
    case 4:
      for (let i = 0; i < line.length; i += 1) {
        const a = i >= bpp ? line[i - bpp]! : 0;
        const b = prev[i]!;
        const c = i >= bpp ? prev[i - bpp]! : 0;
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        const pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        line[i] = (line[i]! + pred) & 0xff;
      }
      return;
    default:
      throw new PngDecodeError(`tipo de filtro desconhecido: ${filterType}`);
  }
}

/**
 * Decodifica um PNG em pixels RGBA de 8 bits.
 *
 * @throws {PngDecodeError} quando o buffer não é PNG, usa 16 bits por canal,
 *   é entrelaçado, ou tem um tipo de cor fora da tabela.
 */
export function decodePng(buf: Buffer): DecodedPng {
  if (buf.length < 8 || !buf.subarray(0, 8).equals(SIGNATURE)) {
    throw new PngDecodeError('o buffer não começa com a assinatura PNG');
  }

  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  let palette: Buffer | undefined;
  let transparency: Buffer | undefined;
  const idat: Buffer[] = [];

  let offset = 8;
  while (offset + 8 <= buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.toString('ascii', offset + 4, offset + 8);
    const data = buf.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length; // 4 comprimento + 4 tipo + dados + 4 CRC

    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8]!;
      colorType = data[9]!;
      interlace = data[12]!;
    } else if (type === 'PLTE') {
      palette = Buffer.from(data);
    } else if (type === 'tRNS') {
      transparency = Buffer.from(data);
    } else if (type === 'IDAT') {
      idat.push(Buffer.from(data));
    } else if (type === 'IEND') {
      break;
    }
  }

  if (width <= 0 || height <= 0) {
    throw new PngDecodeError('IHDR ausente ou com dimensões inválidas');
  }
  if (bitDepth !== 8) {
    throw new PngDecodeError(
      `profundidade de ${bitDepth} bits não é suportada (só 8) — ` +
        'a imagem foi paga, converta para 8 bits antes de reprocessar',
    );
  }
  if (interlace !== 0) {
    throw new PngDecodeError('PNG entrelaçado (Adam7) não é suportado');
  }
  const channels = CHANNELS[colorType];
  if (channels === undefined) {
    throw new PngDecodeError(`tipo de cor desconhecido: ${colorType}`);
  }
  if (idat.length === 0) {
    throw new PngDecodeError('nenhum chunk IDAT no arquivo');
  }

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const bpp = channels; // 8 bits por canal → um byte por canal
  const esperado = height * (stride + 1);
  if (raw.length < esperado) {
    throw new PngDecodeError(
      `dados comprimidos incompletos: ${raw.length} bytes para ${esperado} esperados`,
    );
  }

  const rgba = Buffer.alloc(width * height * 4);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y += 1) {
    const base = y * (stride + 1);
    const filterType = raw[base]!;
    const line = Buffer.from(raw.subarray(base + 1, base + 1 + stride));
    unfilter(filterType, line, prev, bpp);
    prev = line;

    for (let x = 0; x < width; x += 1) {
      const out = (y * width + x) * 4;
      switch (colorType) {
        case 0: {
          const v = line[x]!;
          rgba[out] = v;
          rgba[out + 1] = v;
          rgba[out + 2] = v;
          rgba[out + 3] = 255;
          break;
        }
        case 2: {
          const i = x * 3;
          rgba[out] = line[i]!;
          rgba[out + 1] = line[i + 1]!;
          rgba[out + 2] = line[i + 2]!;
          rgba[out + 3] = 255;
          break;
        }
        case 3: {
          const idx = line[x]!;
          if (!palette) throw new PngDecodeError('tipo de cor 3 sem chunk PLTE');
          const p = idx * 3;
          rgba[out] = palette[p] ?? 0;
          rgba[out + 1] = palette[p + 1] ?? 0;
          rgba[out + 2] = palette[p + 2] ?? 0;
          rgba[out + 3] = transparency?.[idx] ?? 255;
          break;
        }
        case 4: {
          const i = x * 2;
          const v = line[i]!;
          rgba[out] = v;
          rgba[out + 1] = v;
          rgba[out + 2] = v;
          rgba[out + 3] = line[i + 1]!;
          break;
        }
        default: {
          const i = x * 4;
          rgba[out] = line[i]!;
          rgba[out + 1] = line[i + 1]!;
          rgba[out + 2] = line[i + 2]!;
          rgba[out + 3] = line[i + 3]!;
        }
      }
    }
  }

  return { width, height, rgba };
}
