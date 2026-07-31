/**
 * Importa arte-base e altura do personagem com validação local.
 *
 * Toda validação roda ANTES de qualquer submissão porque o 422 chega DEPOIS
 * da submissão, e a submissão é onde o dinheiro sai. Validar localmente evita
 * cobrança por request inválido.
 *
 * NENHUMA chamada de rede neste módulo — é validação pura de cliente.
 */
import { validateSize } from '../../pixellab-pipeline/src/endpoints.ts';
import { S } from './strings.ts';

// ----------------------------------------------------- assinatura PNG

const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

/** True se os primeiros 8 bytes batem com a assinatura PNG. */
function isPNG(buffer: ArrayBuffer): boolean {
  if (buffer.byteLength < 8) return false;
  const bytes = new Uint8Array(buffer, 0, 8);
  return PNG_SIGNATURE.every((b, i) => b === bytes[i]);
}

// ----------------------------------------------------- leitura de IHDR

interface PNGInfo {
  readonly width: number;
  readonly height: number;
}

/** Lê largura e altura do chunk IHDR de um PNG válido. Devolve null se o
 *  buffer não for PNG ou não tiver IHDR legível. */
function readPNGInfo(buffer: ArrayBuffer): PNGInfo | null {
  if (!isPNG(buffer)) return null;
  if (buffer.byteLength < 24) return null; // 8 sig + 4 len + 4 IHDR + 4 w + 4 h
  const view = new DataView(buffer);
  // IHDR começa no byte 8: 4 bytes de length, 4 bytes 'IHDR', 4 width, 4 height
  const chunkLen = view.getUint32(8, false);
  const chunkType = String.fromCharCode(
    view.getUint8(12), view.getUint8(13), view.getUint8(14), view.getUint8(15),
  );
  if (chunkType !== 'IHDR' || chunkLen < 13) return null;
  const width = view.getUint32(16, false);
  const height = view.getUint32(20, false);
  return { width, height };
}

// ----------------------------------------------------- API pública

export interface ImportOk {
  readonly ok: true;
  /** Largura real da imagem (px). */
  readonly width: number;
  /** Altura real da imagem (px). */
  readonly height: number;
  /** Altura do personagem informada pelo usuário (px). */
  readonly charHeight: number;
}

export interface ImportErr {
  readonly ok: false;
  /** Mensagem de erro em pt-BR, originada de strings.ts. */
  readonly error: string;
}

export type ImportResult = ImportOk | ImportErr;

/**
 * Valida um PNG de arte-base (virado para o sul) contra as restrições locais.
 *
 * Regras, na ordem em que são checadas:
 * 1. Arquivo precisa ser PNG.
 * 2. Nenhum lado pode passar de 256 px (limite da API para referência).
 * 3. A imagem precisa ser quadrada (largura = altura).
 * 4. Os lados precisam estar na faixa 16–128 px (faixa dos endpoints de criação).
 * 5. A altura informada não pode exceder a altura da imagem.
 *
 * @param buffer Conteúdo binário do arquivo (ArrayBuffer).
 * @param charHeight Altura do personagem em pixels informada pelo usuário.
 * @returns ImportOk com as dimensões validadas, ou ImportErr com mensagem em pt-BR.
 */
export function validateImport(
  buffer: ArrayBuffer,
  charHeight: number,
): ImportResult {
  // 1. PNG?
  if (!isPNG(buffer)) {
    return { ok: false, error: S.erro.formatoInvalido };
  }

  const info = readPNGInfo(buffer);
  if (!info) {
    return { ok: false, error: S.erro.formatoInvalido };
  }

  const { width, height } = info;

  // 2. Nenhum lado acima de 256.
  if (width > 256 || height > 256) {
    return { ok: false, error: S.erro.ladoAcimaDe256 };
  }

  // 3. Imagem precisa ser quadrada — a ausência de igualdade entre largura
  //    e altura é recusada porque o image_size dos endpoints de criação é
  //    sempre quadrado e a referência precisa casar com ele.
  if (width !== height) {
    return { ok: false, error: S.erro.imagemNaoQuadrada };
  }

  // 4. Faixa 16–128 — validada via validateSize do pipeline.
  const sizeErrors = validateSize('create-character-with-4-directions', { width, height });
  if (sizeErrors.length > 0) {
    return { ok: false, error: S.erro.ladoForaDaFaixa };
  }

  // 5. Altura informada não pode exceder a altura da imagem.
  if (charHeight > height) {
    return { ok: false, error: S.erro.alturaMaiorQueImagem };
  }

  return { ok: true, width, height, charHeight };
}
