/**
 * Moldes de proporção: adulto e criança.
 *
 * ## O que um molde é, e o que ele não é
 *
 * Um molde é um manequim de madeira desenhado de frente, num quadro quadrado.
 * Ele carrega **duas** informações e nenhuma terceira: onde o corpo assenta no
 * quadro e que fração do quadro ele ocupa. Medido nos arquivos deste diretório
 * (2026-08-02, caixa dos pixels opacos num quadro de 256×256):
 *
 * | Molde   | caixa opaca        | altura | linha de chão |
 * |---------|--------------------|--------|----------------|
 * | adulto  | x 85–232, y 18–251 | 233 px | y = 251        |
 * | criança | x 93–226, y 103–251| 148 px | y = 251        |
 *
 * A linha de chão é a mesma nos dois e a altura muda — é isso, e só isso, que
 * distingue os dois moldes. Aparência não vem daqui: vem do `description` do
 * usuário e do andaime de `mannequin-prompt.ts`.
 *
 * ## Por que ele cabe no request sem inventar parâmetro
 *
 * O `/create-image-bitforge` — o endpoint que gera a face sul — declara **cinco**
 * campos de imagem independentes no spec vendorizado: `init_image`
 * (+`init_image_strength`, inteiro 1–999, default 300), `style_image`
 * (+`style_strength`, inteiro 0–100, default 0, "50 = balanced"),
 * `color_image`, `inpainting_image` e `mask_image`. O wizard usava dois.
 *
 * Com molde, os dois papéis se separam pelo campo certo:
 *
 * - **molde → `init_image`**: estrutura. É o campo que decide composição, e é
 *   por isso que a proporção mora nele.
 * - **referência do usuário → `style_image`**: aparência. Era `init_image` antes
 *   do molde existir, e continua sendo quando não há molde.
 *
 * Nenhum endpoint de personagem aceita array de imagens; o que existe são slots
 * distintos com semânticas distintas, e é exatamente do que a tarefa precisava.
 *
 * ## A armadilha que este módulo fecha
 *
 * O molde é um boneco de madeira articulado. Mandado como `init_image` numa
 * força alta, ele não empresta só a proporção — empresta a madeira, as juntas
 * esféricas e a cabeça de ovo. Duas travas contra isso:
 *
 * 1. **Força moderada** (`MOLD_INIT_STRENGTH`), não a de "variação fiel".
 * 2. **`MOLD_NEGATIVE`**, que nomeia o boneco para o modelo evitá-lo.
 *
 * Sem as duas, o resultado é um manequim de madeira em vez de um personagem com
 * a proporção do manequim.
 */
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { decode, resampleNearest } from './frame-fit.ts';
import type { MoldId } from './model.ts';
import { encodePngFromRgba } from './png.ts';

// `MOLD_IDS`, `MoldId` e `isMoldId` moram em `model.ts`, não aqui: a interface
// precisa deles para desenhar o seletor, e este módulo importa `node:fs`. É a
// mesma razão pela qual `blocks-body.ts` não importa `world-block.ts`.

/**
 * Diretório dos moldes. Fica em `packages/game-assets/`, junto do pacote do
 * manequim, porque é asset versionado do projeto e não arte gerada — arte
 * gerada mora em `assets/`, que é gitignored.
 *
 * O override existe para teste, no mesmo espírito de
 * `CHARACTER_BUILDER_ASSETS_DIR`.
 */
const ROOT = new URL('..', import.meta.url).pathname;
export const MOLD_DIR =
  process.env['CHARACTER_BUILDER_MOLD_DIR'] ??
  join(ROOT, '../../packages/game-assets/moldes');

/** Nome de arquivo de cada molde, dentro de `MOLD_DIR`. */
export function moldPath(id: MoldId, dir: string = MOLD_DIR): string {
  return join(dir, `${id}.png`);
}

export function moldExists(id: MoldId, dir: string = MOLD_DIR): boolean {
  return existsSync(moldPath(id, dir));
}

/**
 * Força do molde como `init_image`.
 *
 * O spec declara 1–999, default 300, e o próprio wizard já usava 500 para a
 * referência do usuário citando a faixa 400–600 como a de "variações fiéis de
 * uma imagem existente". Fidelidade é justamente o que NÃO se quer de um boneco
 * de madeira: 320 fica um degrau acima do default, perto o bastante para a
 * composição pegar e longe o bastante da faixa que copiaria o material.
 *
 * Não é número medido. É ponto de partida defensável, e está numa constante
 * para que ajustá-lo seja mexer numa constante.
 */
export const MOLD_INIT_STRENGTH = 320;

/**
 * Força da referência do usuário como `style_image`, quando há molde.
 *
 * O spec descreve o campo como "Strength of the style transfer (0-100). 50 =
 * balanced", e 50 é o que usamos: o texto do usuário continua mandando na
 * aparência, e a referência empurra a paleta e o traço.
 */
export const REFERENCE_STYLE_STRENGTH = 50;

/**
 * Negativo específico do molde: nomeia o boneco de madeira para que a estrutura
 * atravesse e o material não.
 *
 * Só entra no request quando há molde. Fora do modo molde, mandar isto seria
 * proibir palavras que ninguém convidou.
 */
export const MOLD_NEGATIVE =
  'wooden mannequin, artist mannequin, wooden doll, wood texture, wood grain, ' +
  'varnished wood, ball joints, visible joints, segmented limbs, ' +
  'lay figure, drawing mannequin, egg-shaped blank head';

/**
 * Lê um molde e devolve base64 de um PNG `size × size`.
 *
 * O reescalonamento é vizinho-mais-próximo, a mesma amostragem que o resto do
 * projeto usa para pixel art, e preserva o enquadramento: o molde é reescalado
 * inteiro, sem recorte. É de propósito — recortar a margem transparente
 * destruiria a altura relativa, que é a única coisa que o molde tem a dizer.
 *
 * @param id    Qual molde.
 * @param size  Lado do quadro pedido, em pixels. Vem de `character.size`.
 * @param dir   Diretório dos moldes; default `MOLD_DIR`.
 */
export async function readMoldPngB64(
  id: MoldId,
  size: number,
  dir: string = MOLD_DIR,
): Promise<string> {
  if (!Number.isInteger(size) || size <= 0) {
    throw new Error(`tamanho inválido para molde: ${size}`);
  }
  const buf = await readFile(moldPath(id, dir));
  const src = decode(buf);
  if (src.width === size && src.height === size) {
    return buf.toString('base64');
  }
  const out = resampleNearest(
    src,
    { x: 0, y: 0, width: src.width, height: src.height },
    size,
    size,
  );
  return encodePngFromRgba(out.rgba, size, size).toString('base64');
}

/**
 * Junta os negativos que o request deve carregar quando há molde.
 *
 * A ordem importa pouco para o modelo e muito para quem lê o `studio.json`
 * depois: o negativo do molde vem por último, para que o do usuário continue
 * visível no começo da string.
 */
export function withMoldNegative(existing: string | undefined): string {
  const base = existing?.trim().replace(/^[,\s]+|[,\s]+$/g, '');
  return base ? `${base}, ${MOLD_NEGATIVE}` : MOLD_NEGATIVE;
}
