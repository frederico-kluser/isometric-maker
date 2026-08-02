/**
 * Giro RÍGIDO da câmera — o quadro inteiro gira como um corpo só (ADR 0030).
 *
 * ## O problema que este módulo substitui
 *
 * A transição da ADR 0026 interpolava a POSIÇÃO de cada bloco (grid rotacionado
 * por ângulo contínuo, projetado pela fórmula de sempre) e mantinha cada sprite
 * sem girar. A matemática está certa — e é exatamente por isso que fica errada
 * na tela: no meio do giro o reticulado projetado comprime e estica, mas cada
 * sprite mantém o próprio tamanho. O espaçamento muda e o desenho não; vizinhos
 * abrem fresta e sobrepõem, e o mapa se lê como peças deslizando cada uma por
 * seu caminho, não como uma câmera girando.
 *
 * ## A solução, e de onde ela vem
 *
 * O quadro COMPOSTO da vista de origem e o da vista de destino são tratados como
 * duas imagens únicas, e a transição aplica a cada uma A MESMA transformação
 * afim — o mapa move-se como corpo rígido, com cross-fade entre os dois.
 *
 * Precedentes (pesquisa de 2026-08-01, fontes na ADR 0030):
 *
 * - **Doom (1993), verificado no código**: sprite nunca gira na tela; o motor
 *   SELECIONA uma das 8 rotações pré-desenhadas e deixa a projeção fazer todo o
 *   movimento. Aqui: cada bloco tem 4 vistas pagas (ADR 0029), e a que aparece
 *   é selecionada por vista — nunca reamostrada individualmente.
 * - **Mode 7 / Contra III, verificado**: o cenário composto gira como camada
 *   única enquanto os sprites usam rotações pré-desenhadas. É este padrão,
 *   transplantado: girar a CAMADA composta, não as peças.
 *
 * ## A matriz
 *
 * Com a projeção `P(x, y) = ((x − y)·A, (x + y)·B)` (A = tileWidth/2,
 * B = tileHeight/2) e a rotação contínua `R(τ)` de `rotation-tween.ts`, a
 * transformação de TELA que leva a vista projetada de uma rotação à outra é a
 * conjugação `L(τ) = P ∘ R(τ) ∘ P⁻¹`, que fecha em:
 *
 * ```text
 * L(τ) = [ cos φ        −(A/B)·sin φ ]      φ = −τ·π/2
 *        [ (B/A)·sin φ   cos φ       ]      (mesmo sinal de rotatePointContinuous)
 * ```
 *
 * Que é o "squash–rotate–unsquash": achatar o plano do chão para o espaço onde
 * o giro é circular, girar, desachatar. **Derivação deste projeto** — a mesma
 * pesquisa não encontrou essa construção documentada em lugar nenhum; o que a
 * fixa são os testes de concordância exata com `rotatePoint` nos múltiplos de
 * 90° (`rotation-rigid.test.ts`).
 *
 * ## O que a matriz NÃO cobre, dito com honestidade
 *
 * `L(τ)` é exata para o PLANO DO CHÃO (z = 0). O deslocamento vertical de
 * `z` (−z·zStep, invariante entre vistas) não comuta com `L` no meio do
 * caminho: paredes e pilhas inclinam de leve durante a varredura, e a oclusão
 * de destino só é a certa no quadro final. É por isso que a transição usa DOIS
 * quadros — origem e destino, cada um correto nos extremos — em cross-fade:
 * o desvio de altura e a troca de profundidade ficam escondidos no fade, como
 * no corte suavizado do Mode 7. Zoom uniforme comuta com `L` (escalar), então
 * a mesma matriz vale para qualquer zoom inteiro.
 *
 * Nos `τ` INTEIROS o seno e o cosseno são cravados em {−1, 0, 1} — sem
 * `Math.cos(π/2) = 6.1e−17` vazando para a comparação — e a concordância com a
 * rotação discreta é EXATA, por igualdade estrita, não por tolerância.
 */
import { normalizeRotation } from './rotation.ts';

// ------------------------------------------------------------------ tipos

/**
 * Transformação afim 2D no layout do PixiJS:
 * `x' = a·x + c·y + tx` · `y' = b·x + d·y + ty`.
 *
 * Mantê-lo idêntico ao `Matrix` do Pixi é o que permite `setFromMatrix` sem
 * conversão — e sem o clássico erro de trocar `b` com `c` no caminho.
 */
export interface Affine2D {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly tx: number;
  readonly ty: number;
}

/** O plano do chão: só a razão A/B da projeção importa para o giro. */
export interface GroundPlane {
  readonly tileWidth: number;
  readonly tileHeight: number;
}

// ------------------------------------------------------------------ trigonometria cravada

/**
 * Cosseno/seno de `φ = −τ·π/2` com valores EXATOS nos τ inteiros.
 *
 * `Math.cos(Math.PI / 2)` é 6.1e−17, não 0 — bom o bastante para desenhar e
 * ruim o bastante para quebrar a promessa de "concordância exata nos 90°".
 * O caminho contínuo usa a trigonometria de verdade; os extremos, a tabela.
 */
function quarterTrig(turn: number): { cos: number; sin: number } {
  if (Number.isInteger(turn)) {
    switch (normalizeRotation(turn)) {
      case 1:
        return { cos: 0, sin: -1 };
      case 2:
        return { cos: -1, sin: 0 };
      case 3:
        return { cos: 0, sin: 1 };
      default:
        return { cos: 1, sin: 0 };
    }
  }
  const phi = -turn * (Math.PI / 2);
  return { cos: Math.cos(phi), sin: Math.sin(phi) };
}

// ------------------------------------------------------------------ a matriz

/**
 * Matriz de tela que gira o quadro composto por `turnDelta` quartos de volta
 * em torno do pivô, no plano do chão da projeção dada.
 *
 * `turnDelta` segue a MESMA convenção de `rotatePointContinuous`: `+1` leva a
 * vista `r` à vista `r + 1`. O pivô é o ponto de tela que não se move — na
 * cena, o centro do conteúdo enquadrado.
 */
export function rigidTurnMatrix(
  turnDelta: number,
  plane: GroundPlane,
  pivotX = 0,
  pivotY = 0,
): Affine2D {
  const ratio = plane.tileWidth / plane.tileHeight;
  const { cos, sin } = quarterTrig(turnDelta);
  // `+ 0` em cada campo: `-sin * ratio` com sin = 0 dá `-0`, e `-0` reprova
  // igualdade estrita sem mudar um pixel (mesma armadilha de rotation.ts).
  const a = cos + 0;
  const b = sin / ratio + 0;
  const c = -sin * ratio + 0;
  const d = cos + 0;
  return {
    a,
    b,
    c,
    d,
    tx: pivotX - (a * pivotX + c * pivotY) + 0,
    ty: pivotY - (b * pivotX + d * pivotY) + 0,
  };
}

/** Aplica a afim a um ponto. `+ 0` mata o `-0` (mesma razão de rotation.ts). */
export function applyAffine(m: Affine2D, x: number, y: number): { x: number; y: number } {
  return {
    x: m.a * x + m.c * y + m.tx + 0,
    y: m.b * x + m.d * y + m.ty + 0,
  };
}
