/**
 * Normalização de quadro: tira a margem transparente e faz o sprite preencher.
 *
 * ## O problema que isto resolve
 *
 * O `/create-character-v3` estufa a moldura de propósito. Texto literal do spec
 * vendorizado (2026-08-01,
 * `/home/ondokai/Projects/isometric-maker/tools/pixellab-pipeline/openapi/openapi-v2.json`):
 *
 * > "Final canvas is padded ~2x for animation room (capped at 256)."
 *
 * Medido nos PNGs já pagos deste repositório: pedindo 128 px, voltam quadros de
 * 172×172 com o personagem ocupando 66% da altura e entre 21% e 36% da área. Não
 * existe parâmetro para desligar o padding — a única saída é pós-processar.
 *
 * ## A regra que não pode ser quebrada: uma bbox só para todos os quadros
 *
 * Recortar cada direção com a bbox dela seria o caminho óbvio e está errado: a
 * silhueta de leste é mais estreita que a de sul, então cada direção ganharia uma
 * escala diferente e o personagem mudaria de tamanho ao girar. A bbox é a **união**
 * de todos os quadros passados, e o mesmo retângulo é aplicado a todos — é isso que
 * preserva o alinhamento entre direções e entre frames de uma animação.
 *
 * ## Reamostragem
 *
 * Nearest-neighbor, para exatamente o tamanho alvo. Escala inteira preservaria
 * melhor a grade de pixels mas raramente alcança o quadro cheio (recorte de 123 px
 * num alvo de 128 daria fator 1 e 4% de folga sobrando); o pedido era preencher.
 *
 * O PNG cru pago **nunca** é sobrescrito sem cópia — `fitFramesOnDisk` guarda o
 * original em `raw/` antes de gravar o recorte.
 *
 * A decodificação vem de `decodePngToRgba`, em `png.ts` — o único decodificador
 * do projeto. Ele cobre 8 bits, sem entrelaçamento, nos tipos de cor 0, 2, 4 e
 * 6; paleta (tipo 3) levanta erro nomeado e o recorte é abortado, sem perder a
 * arte já paga.
 */
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { decodePngToRgba, encodePngFromRgba } from './png.ts';

/** Uma imagem decodificada: pixels RGBA de 8 bits, linha a linha, do topo. */
export interface DecodedPng {
  readonly width: number;
  readonly height: number;
  /** `width × height × 4` bytes, na ordem R, G, B, A. */
  readonly rgba: Buffer;
}

/** Adapta o decodificador de `png.ts` (que devolve `data`) ao formato daqui. */
export function decode(buf: Buffer): DecodedPng {
  const { width, height, data } = decodePngToRgba(buf);
  return { width, height, rgba: data };
}

/** Retângulo em pixels. Pode cair fora da imagem — o amostrador trata como vazio. */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Alfa a partir do qual um pixel conta como "tem sprite aqui". */
const ALPHA_THRESHOLD = 8;

/**
 * Menor retângulo que contém todo pixel com alfa acima do limiar.
 * `null` quando a imagem é inteiramente transparente.
 */
export function alphaBBox(
  img: DecodedPng,
  threshold: number = ALPHA_THRESHOLD,
): Rect | null {
  let minX = img.width;
  let minY = img.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < img.height; y += 1) {
    for (let x = 0; x < img.width; x += 1) {
      if (img.rgba[(y * img.width + x) * 4 + 3]! > threshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/** Menor retângulo que contém todos os retângulos dados. */
export function unionRect(rects: readonly Rect[]): Rect {
  if (rects.length === 0) throw new Error('unionRect precisa de pelo menos um retângulo');
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of rects) {
    if (r.x < minX) minX = r.x;
    if (r.y < minY) minY = r.y;
    if (r.x + r.width > maxX) maxX = r.x + r.width;
    if (r.y + r.height > maxY) maxY = r.y + r.height;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Expande o lado menor até virar quadrado, centrando o crescimento.
 *
 * O resultado PODE cair fora da imagem de origem, e é de propósito: forçar o
 * quadrado para dentro da moldura deslocaria o personagem e quebraria o
 * alinhamento entre direções. `resampleNearest` amostra fora da borda como
 * transparente.
 */
export function squareRect(rect: Rect): Rect {
  const side = Math.max(rect.width, rect.height);
  return {
    x: rect.x - Math.floor((side - rect.width) / 2),
    y: rect.y - Math.floor((side - rect.height) / 2),
    width: side,
    height: side,
  };
}

/**
 * Reamostra `src` pelo retângulo `rect` para `targetW × targetH`, nearest-neighbor.
 * Amostras fora da imagem saem transparentes.
 */
export function resampleNearest(
  src: DecodedPng,
  rect: Rect,
  targetW: number,
  targetH: number,
): DecodedPng {
  const out = Buffer.alloc(targetW * targetH * 4);
  for (let ty = 0; ty < targetH; ty += 1) {
    const sy = rect.y + Math.floor(((ty + 0.5) * rect.height) / targetH);
    for (let tx = 0; tx < targetW; tx += 1) {
      const sx = rect.x + Math.floor(((tx + 0.5) * rect.width) / targetW);
      if (sx < 0 || sy < 0 || sx >= src.width || sy >= src.height) continue;
      const s = (sy * src.width + sx) * 4;
      const t = (ty * targetW + tx) * 4;
      out[t] = src.rgba[s]!;
      out[t + 1] = src.rgba[s + 1]!;
      out[t + 2] = src.rgba[s + 2]!;
      out[t + 3] = src.rgba[s + 3]!;
    }
  }
  return { width: targetW, height: targetH, rgba: out };
}

/** Cola `inner` centrado num quadro transparente de `size × size`. */
function centerOnCanvas(inner: DecodedPng, size: number): DecodedPng {
  if (inner.width === size && inner.height === size) return inner;
  const out = Buffer.alloc(size * size * 4);
  const offX = Math.floor((size - inner.width) / 2);
  const offY = Math.floor((size - inner.height) / 2);
  for (let y = 0; y < inner.height; y += 1) {
    const ty = y + offY;
    if (ty < 0 || ty >= size) continue;
    for (let x = 0; x < inner.width; x += 1) {
      const tx = x + offX;
      if (tx < 0 || tx >= size) continue;
      inner.rgba.copy(
        out,
        (ty * size + tx) * 4,
        (y * inner.width + x) * 4,
        (y * inner.width + x) * 4 + 4,
      );
    }
  }
  return { width: size, height: size, rgba: out };
}

export interface FitOptions {
  /** Lado do quadro final, em pixels. */
  readonly size: number;
  /** Folga transparente de cada lado, dentro do quadro final. Default 0. */
  readonly margin?: number;
  /** Alfa mínimo para um pixel contar como sprite. Default 8. */
  readonly threshold?: number;
}

export interface FitResult {
  /** Um PNG por quadro de entrada, na mesma ordem, todos `size × size`. */
  readonly images: readonly Buffer[];
  /** Retângulo de recorte comum aplicado a todos. `null` = tudo transparente. */
  readonly rect: Rect | null;
}

/**
 * Recorta a margem transparente comum e reamostra todos os quadros para
 * `size × size`.
 *
 * Todos os quadros entram no cálculo da bbox e saem com o MESMO retângulo — é o
 * que mantém a escala do personagem estável entre direções e entre frames.
 * Quadro inteiramente transparente entra na conta como ausente (não estufa a
 * bbox) e sai reamostrado igual aos outros, ou seja, transparente.
 *
 * Se TODOS os quadros forem transparentes, os bytes originais voltam intactos.
 */
export function fitFrames(pngs: readonly Buffer[], opts: FitOptions): FitResult {
  const { size } = opts;
  const margin = opts.margin ?? 0;
  if (!Number.isInteger(size) || size <= 0) {
    throw new Error(`tamanho de quadro inválido: ${size}`);
  }
  const inner = size - 2 * margin;
  if (inner <= 0) {
    throw new Error(`margem ${margin} não cabe num quadro de ${size} px`);
  }

  const decoded = pngs.map((b) => decode(b));
  const boxes = decoded
    .map((img) => alphaBBox(img, opts.threshold ?? ALPHA_THRESHOLD))
    .filter((r): r is Rect => r !== null);

  if (boxes.length === 0) return { images: pngs, rect: null };

  const rect = squareRect(unionRect(boxes));
  const images = decoded.map((img) => {
    const scaled = resampleNearest(img, rect, inner, inner);
    const framed = centerOnCanvas(scaled, size);
    return encodePngFromRgba(framed.rgba, framed.width, framed.height);
  });
  return { images, rect };
}

/**
 * Aplica `fitFrames` a arquivos já gravados em disco.
 *
 * O original pago é copiado para `raw/<nome>.png` ANTES de o recorte
 * sobrescrever o arquivo — a regra do repositório é que depois da cobrança
 * perder a imagem é dinheiro perdido, e o recorte é destrutivo por definição.
 * Uma cópia em `raw/` que já exista não é sobrescrita: ela é o original, e
 * rodar de novo sobre um arquivo já recortado não pode apagar isso.
 *
 * Os caminhos de saída são os MESMOS da entrada, então nada a jusante muda.
 */
export async function fitFramesOnDisk(
  paths: readonly string[],
  opts: FitOptions,
): Promise<FitResult> {
  if (paths.length === 0) return { images: [], rect: null };

  const originals: Buffer[] = [];
  for (const p of paths) {
    const rawCopy = join(dirname(p), 'raw', basename(p));
    if (existsSync(rawCopy)) {
      // Já normalizado antes: a fonte da verdade é a cópia crua.
      originals.push(await readFile(rawCopy));
    } else {
      await mkdir(dirname(rawCopy), { recursive: true });
      await copyFile(p, rawCopy);
      originals.push(await readFile(p));
    }
  }

  const result = fitFrames(originals, opts);
  if (result.rect === null) return result;

  for (let i = 0; i < paths.length; i += 1) {
    await writeFile(paths[i]!, result.images[i]!);
  }
  return result;
}
