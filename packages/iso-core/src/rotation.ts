/**
 * Rotação da câmera isométrica — quatro vistas de 90°.
 *
 * ## O que rotaciona, e o que não
 *
 * A rotação é um **parâmetro de vista**, nunca um dado do documento. O mapa
 * armazenado jamais é reescrito quando a câmera gira: `BlockStore`, `EdgeStore`
 * e o arquivo de projeto ficam intactos. O que gira é a coordenada, no caminho
 * até a tela, e só ali.
 *
 * Isso vem de OpenRCT2 — o motor isométrico canônico com quatro vistas e altura
 * discreta —, que guarda a rotação como inteiro e avança com `(rot + d) & 3`.
 * Não há ângulo contínuo, matriz nem trigonometria em nenhum ponto do caminho.
 *
 * ## A transformação
 *
 * ```text
 * rot 0 → ( x,  y)     rot 1 → ( y, −x)     rot 2 → (−x, −y)     rot 3 → (−y,  x)
 * ```
 *
 * Anti-horário cai fora do complemento de dois: `-1 & 3 === 3`.
 *
 * ## Z é invariante
 *
 * `z` não entra na rotação — a altura é a mesma nas quatro vistas. Aqui isso é
 * explícito: {@link rotateCell} recebe e devolve `z` sem tocá-lo, em vez de
 * "preservar por acidente".
 *
 * ## A chave de profundidade PRECISA ser recalculada
 *
 * `depthKey = x + y + z` **não sobrevive à rotação**: o termo `z` entra igual
 * nas quatro vistas, mas `x + y` não. Em termos das coordenadas ARMAZENADAS:
 *
 * ```text
 * rot0: x + y      rot1: y − x      rot2: −(x + y)      rot3: x − y
 * ```
 *
 * Este módulo **não** materializa essas quatro expressões. Rotaciona `(x, y)`
 * primeiro e deixa quem ordena usar o mesmo `x' + y'` nas quatro vistas — um
 * caminho de código em vez de quatro. Ver {@link rotatedDepthKey}.
 *
 * ## O que este módulo NÃO resolve
 *
 * Oclusão. O motor de referência resolve ordem de desenho por comparação
 * par-a-par de caixas 3D, mantém duas implementações de ordenação, e o próprio
 * mantenedor descreve a variante estável como algo que "melhora drasticamente o
 * z-fighting, mas não o torna perfeito". Uma cena acíclica de uma vista pode ser
 * cíclica de outra. A restrição de sprite de célula única
 * (`packages/iso-core/src/map.ts`) continua carregando peso justamente por isso.
 */

// ------------------------------------------------------------------ tipos

/** Vista da câmera: 0, 1, 2 ou 3. Qualquer outro valor é normalizado. */
export type Rotation = 0 | 1 | 2 | 3;

/** As quatro vistas, em ordem de giro. */
export const ROTATIONS: readonly Rotation[] = [0, 1, 2, 3] as const;

/** Rótulos pt-BR das vistas — o editor os exibe no controle de câmera. */
export const ROTATION_LABELS: Readonly<Record<Rotation, string>> = {
  0: 'Sul',
  1: 'Oeste',
  2: 'Norte',
  3: 'Leste',
};

export interface Cell2D {
  readonly x: number;
  readonly y: number;
}

export interface Cell3D extends Cell2D {
  readonly z: number;
}

// ------------------------------------------------------------------ normalização

/**
 * Normaliza qualquer inteiro para uma das quatro vistas.
 *
 * Usa `& 3` como o motor de referência: para inteiros isso é o módulo 4 que
 * também trata negativo do jeito certo (`-1 & 3 === 3`), enquanto `% 4`
 * devolveria `-1`.
 */
export function normalizeRotation(value: number): Rotation {
  return (Math.trunc(value) & 3) as Rotation;
}

/** Gira a câmera `steps` passos de 90° (negativo = anti-horário). */
export function turn(rotation: Rotation, steps: number): Rotation {
  return normalizeRotation(rotation + steps);
}

// ------------------------------------------------------------------ transformação

/**
 * Zero positivo sempre.
 *
 * A negação de `0` em JavaScript dá `-0`, e `-0` passa despercebido até não
 * passar: `Object.is(-0, 0)` é false, `assert.deepStrictEqual` reprova, e uma
 * célula `{x: 1, y: -0}` deixa de bater com `{x: 1, y: 0}` numa comparação de
 * seleção — apesar de as duas virarem a mesma chave `"1:0"`. Somar zero é a
 * normalização: `-0 + 0` é `+0`, e qualquer outro valor passa intacto.
 */
const noNegativeZero = (n: number): number => n + 0;

/**
 * Rotaciona uma coordenada de grid para a vista dada.
 *
 * Pura rotação de 90°, sem termo de translação — o mesmo que o motor de
 * referência aplica antes de sua única fórmula de projeção.
 */
export function rotatePoint(x: number, y: number, rotation: Rotation): Cell2D {
  switch (normalizeRotation(rotation)) {
    case 1:
      return { x: noNegativeZero(y), y: noNegativeZero(-x) };
    case 2:
      return { x: noNegativeZero(-x), y: noNegativeZero(-y) };
    case 3:
      return { x: noNegativeZero(-y), y: noNegativeZero(x) };
    default:
      return { x: noNegativeZero(x), y: noNegativeZero(y) };
  }
}

/**
 * Inversa de {@link rotatePoint}: da coordenada da vista de volta à armazenada.
 *
 * É esta que o picking usa. O cursor vive em coordenadas de vista; o mapa vive
 * em coordenadas armazenadas, e converter na direção errada faz o clique cair
 * na célula certa só na vista 0.
 */
export function unrotatePoint(x: number, y: number, rotation: Rotation): Cell2D {
  return rotatePoint(x, y, normalizeRotation(-rotation));
}

/**
 * Rotaciona uma célula 3D. `z` é copiado, não transformado.
 *
 * A reanexação explícita é intencional: no motor de referência a rotação fatia
 * para o tipo 2D e cada chamador reanexa `z` na mão. Copiar o padrão sem copiar
 * esse detalhe é como `z` acaba girando junto.
 */
export function rotateCell(cell: Cell3D, rotation: Rotation): Cell3D {
  const r = rotatePoint(cell.x, cell.y, rotation);
  return { x: r.x, y: r.y, z: cell.z };
}

export function unrotateCell(cell: Cell3D, rotation: Rotation): Cell3D {
  const r = unrotatePoint(cell.x, cell.y, rotation);
  return { x: r.x, y: r.y, z: cell.z };
}

// ------------------------------------------------------------------ profundidade

/**
 * Chave de profundidade da célula NA VISTA dada.
 *
 * Rotaciona e só então soma — um caminho, não quatro expressões. Algebricamente
 * equivalente às quatro formas em termos das coordenadas armazenadas, e sem a
 * chance de errar o sinal de uma delas.
 */
export function rotatedDepthKey(cell: Cell3D, rotation: Rotation): number {
  const r = rotatePoint(cell.x, cell.y, rotation);
  return r.x + r.y + cell.z;
}

// ------------------------------------------------------------------ sprites direcionais

/**
 * Reindexa uma direção de sprite para a vista atual.
 *
 * Para N direções igualmente espaçadas, cada giro de 90° avança `N/4` índices.
 * Com as 8 direções canônicas deste projeto isso são **2 por giro**; com as 4
 * faces de um bloco do mundo, **1 por giro**.
 *
 * **A magnitude é forçada pela geometria; o SENTIDO não é.** Nada no material
 * consultado estabelece se a rotação avança horária ou anti-horária em relação
 * à ordem de direções deste projeto. O sentido aqui — somar — é a convenção
 * ADOTADA por este repositório, e o que a fixa são os testes de
 * `rotation.test.ts` mais a conferência visual no editor. Trocar o sinal aqui
 * faz os sprites olharem para trás em duas das quatro vistas.
 */
export function rotateDirectionIndex(
  index: number,
  directionCount: number,
  rotation: Rotation,
): number {
  if (directionCount <= 0 || directionCount % 4 !== 0) {
    throw new Error(
      `directionCount precisa ser múltiplo positivo de 4 (recebido ${directionCount}): ` +
        'só assim um giro de 90° cai exatamente sobre uma direção existente.',
    );
  }
  const step = directionCount / 4;
  const shifted = index + normalizeRotation(rotation) * step;
  return ((shifted % directionCount) + directionCount) % directionCount;
}

// ------------------------------------------------------------------ arestas

/** Lados de aresta na mesma ordem horária de {@link ROTATIONS}. */
const EDGE_ORDER = ['N', 'L', 'S', 'O'] as const;
type EdgeSideLocal = (typeof EDGE_ORDER)[number];

/**
 * Reindexa o lado de uma parede para a vista atual.
 *
 * Uma parede no lado norte vira a parede do lado leste depois de um giro. Sem
 * isso, girar a câmera desenha as paredes nas arestas erradas — um erro que
 * some na vista 0 e aparece nas outras três.
 */
export function rotateEdgeSide(lado: EdgeSideLocal, rotation: Rotation): EdgeSideLocal {
  const i = EDGE_ORDER.indexOf(lado);
  if (i < 0) throw new Error(`lado de aresta desconhecido: "${lado}"`);
  return EDGE_ORDER[rotateDirectionIndex(i, 4, rotation)]!;
}
