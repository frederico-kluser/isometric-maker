/**
 * Animação do bloco no editor 3D — a lógica pura, sem Three.js e sem DOM.
 *
 * O usuário PAGOU por blocos animados (ADR 0032: um cubo base do
 * `/create-isometric-tile` mais os quadros do `/animate-with-text-v3`), e até
 * 2026-08-04 o editor 3D nunca desenhou essa animação: `spritesheetUrl`, `fps`,
 * `frameCount` e `pingPong` atravessavam o catálogo, o `blocks-api.ts` e o
 * `BlockDef` inteiros para morrer sem serem lidos. A tela do mapa mostrava um
 * quadro parado; só a prévia do laboratório animava, e ela anima por outro
 * caminho (os PNGs soltos de `frames/`).
 *
 * ## Por que a lógica mora num módulo puro
 *
 * Não há jsdom nem testing-library neste repositório, e instalar qualquer um
 * dos dois é proibido. O que decide QUAL quadro aparece — tempo, fps,
 * vai-e-volta, e se a folha em disco descreve mesmo o cubo — é aritmética, e
 * aritmética se testa com `node --test`. O que sobra para `cube3d.ts` é
 * exatamente o que precisa de GPU: criar a textura e empurrar o `offset`.
 *
 * ## O contrato do desenho sob demanda (ADR 0040)
 *
 * O editor tem UM laço de quadro e ele **para sozinho** quando nada muda. Uma
 * animação contínua brigaria de frente com isso, então o animador aqui responde
 * duas perguntas separadas, e é o laço quem decide:
 *
 * - `advance(now)` devolve `true` só quando algum bloco TROCOU de quadro. A 8
 *   fps num monitor de 60 Hz, sete de cada oito quadros não precisam de desenho.
 * - `hasLive()` diz se ainda existe animação viva. É isso que mantém o `rAF`
 *   agendado — e é isso que o deixa parar quando o último bloco animado sai do
 *   mapa, quando a paleta troca, ou quando o usuário pede menos movimento.
 *
 * Um bloco animado que está na PALETA mas não no MAPA não conta: `setActive`
 * recebe os ids que `syncBlocks` de fato colocou na cena. Sem isso, abrir o
 * editor com um bloco animado na paleta e um mapa vazio queimaria GPU para
 * sempre desenhando um mapa parado.
 *
 * ## Uma folha, um material, uma fase
 *
 * Todos os cubos do mesmo bloco compartilham o material (e portanto a textura),
 * então todas as cópias de um bloco animam em fase. É consequência do desenho de
 * `cube3d.ts`, não descuido: um material por instância multiplicaria as draw
 * calls por bloco colocado.
 */

/**
 * FPS de quem não declarou nada.
 *
 * É o mesmo default do servidor (`server/model.ts`,
 * `DEFAULT_BLOCK_ANIMATION_FPS`) e o mesmo que a prévia do laboratório usa. A
 * constante é repetida em vez de importada porque `server/model.ts` é módulo do
 * servidor: puxá-lo daqui arrastaria o servidor para dentro do bundle do editor.
 */
export const DEFAULT_BLOCK_ANIMATION_FPS = 8;

/** O que define a reprodução de um bloco animado. */
export interface AnimationClip {
  /** Quantos quadros a folha tem. Sempre >= 2 — 1 quadro não é animação. */
  readonly frameCount: number;
  /** Quadros por segundo. Post-processing: nunca custou nada à API. */
  readonly fps: number;
  /** Vai-e-volta (0→1→2→3→2→1→0…) em vez de reiniciar (0→1→2→3→0…). */
  readonly pingPong: boolean;
}

/** Os campos do `BlockDef` que descrevem animação. Frouxo de propósito: o que chega do catálogo é JSON. */
export interface AnimationFields {
  readonly animated?: boolean | undefined;
  readonly frameCount?: number | undefined;
  readonly fps?: number | undefined;
  readonly pingPong?: boolean | undefined;
}

/**
 * O clipe de um bloco, ou `null` quando ele não anima.
 *
 * `animated === false` é a declaração explícita do servidor para o bloco de
 * `frameCount: 0` (gerado sem `animate-with-text-v3`). `frameCount < 2` cobre o
 * resto: um quadro só é uma imagem parada, e tratá-lo como animação manteria o
 * laço de quadro acordado para nunca trocar nada.
 *
 * Os defaults seguem a prévia do laboratório para os dois lugares nunca
 * discordarem: fps 8 quando ausente ou inválido, ping-pong ligado salvo
 * `false` explícito.
 */
export function animationClipOf(source: AnimationFields): AnimationClip | null {
  if (source.animated === false) return null;
  const frameCount = source.frameCount;
  if (
    typeof frameCount !== 'number' ||
    !Number.isFinite(frameCount) ||
    frameCount < 2
  ) {
    return null;
  }
  const rawFps = source.fps;
  const fps =
    typeof rawFps === 'number' && Number.isFinite(rawFps) && rawFps >= 1
      ? rawFps
      : DEFAULT_BLOCK_ANIMATION_FPS;
  return {
    frameCount: Math.floor(frameCount),
    fps,
    pingPong: source.pingPong !== false,
  };
}

/**
 * Qual quadro está no ar em `elapsedMs`.
 *
 * A fórmula é a MESMA da prévia do laboratório
 * (`src/app/screens/laboratorio/blocks-panel.tsx`), de propósito: o bloco não
 * pode animar de um jeito na bancada e de outro no mapa. A diferença é só a
 * origem do tique — lá um `setInterval`, aqui o relógio do laço de quadro, que
 * é o que permite pular quadros sem acumular atraso.
 *
 * O período do vai-e-volta é `2·(n−1)`, e não `2n`: com `2n` os extremos
 * apareceriam dois tiques seguidos e a animação daria uma travadinha nas pontas.
 */
export function frameIndexAt(elapsedMs: number, clip: AnimationClip): number {
  const { frameCount, fps, pingPong } = clip;
  if (frameCount <= 1) return 0;
  const ms = Number.isFinite(elapsedMs) && elapsedMs > 0 ? elapsedMs : 0;
  const tick = Math.floor((ms * fps) / 1000);
  if (!pingPong) return tick % frameCount;
  const period = 2 * (frameCount - 1);
  const m = tick % period;
  return m >= frameCount ? period - m : m;
}

// ------------------------------------------------------------------ a folha

/** Como os quadros estão dispostos na folha. A tira é horizontal, sem calha. */
export interface SheetLayout {
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly frameCount: number;
}

/**
 * Divide a folha em quadros, ou `null` quando ela não é uma tira exata.
 *
 * `packSpritesheet` grava `frameCount` quadros lado a lado, sem calha, todos do
 * tamanho do primeiro. Se a largura não for múltipla da contagem, a folha não é
 * o que o sidecar diz que é — e adivinhar o resto pintaria o cubo com meio
 * quadro do vizinho.
 *
 * **Nada aqui conhece 48.** O quadro é medido da folha, como a geometria é
 * medida da imagem (`spriteGeometryFromImage`).
 */
export function sheetLayout(
  sheetWidth: number,
  sheetHeight: number,
  frameCount: number,
): SheetLayout | null {
  if (!Number.isInteger(frameCount) || frameCount < 2) return null;
  if (!Number.isInteger(sheetWidth) || !Number.isInteger(sheetHeight)) return null;
  if (sheetWidth <= 0 || sheetHeight <= 0) return null;
  if (sheetWidth % frameCount !== 0) return null;
  return {
    frameWidth: sheetWidth / frameCount,
    frameHeight: sheetHeight,
    frameCount,
  };
}

/**
 * Deslocamento horizontal da textura para mostrar o quadro `index`.
 *
 * Com `repeat.x = 1/n` e `offset.x = index/n`, o UV 0..1 que a geometria do cubo
 * escreve cai exatamente dentro de um quadro. É por isso que a animação não
 * mexe em UV nenhum: a geometria continua a mesma, compartilhada por proporção,
 * e quem anda é a matriz da textura.
 */
export function frameOffsetU(index: number, frameCount: number): number {
  if (frameCount <= 0) return 0;
  const clamped = Math.min(Math.max(Math.trunc(index), 0), frameCount - 1);
  return clamped / frameCount;
}

/** `repeat.x` da textura da folha — a fração que um quadro ocupa. */
export function frameRepeatU(frameCount: number): number {
  return frameCount > 0 ? 1 / frameCount : 1;
}

/** Tamanho de uma imagem já carregada. */
export interface ImageSize {
  readonly width: number;
  readonly height: number;
}

/** O veredito sobre a folha: ou ela serve, ou há um motivo escrito. */
export type SheetVerdict =
  | { readonly ok: true; readonly layout: SheetLayout }
  | { readonly ok: false; readonly reason: string };

/**
 * A folha descreve mesmo este bloco?
 *
 * **Esta função existe por causa de duas folhas pagas que estão erradas em
 * disco.** `packSpritesheet` foi corrigido numa onda anterior para usar a
 * dimensão REAL do quadro, mas as folhas gravadas antes disso ficaram com o
 * antigo 48×48 fixo: `a880b32d82456c4e` é 432×48 (9 quadros) e
 * `df00c6479810988c` é 240×48 (5 quadros), enquanto os `frames/*.png` e o
 * `base.png` ao lado estão íntegros em 48×53. Enquanto ninguém lia a folha isso
 * era inofensivo. A partir do momento em que o mapa lê, uma folha 48×48 esticada
 * sobre um cubo de 48×53 mostraria arte comprada com as cinco linhas da base
 * cortadas — e nada reclamaria.
 *
 * O servidor re-empacota essas folhas a partir de `frames/` (custo zero). Este
 * veredito é a segunda linha de defesa: um bloco cuja folha continue
 * discordando **degrada para o quadro parado** em vez de quebrar o mapa.
 *
 * A comparação é contra os PIXELS do quadro parado, não contra a `geometry` do
 * manifesto. Declaração é o que já estava errado nos dois blocos; pixel é o que
 * está certo neles.
 */
export function checkSheet(
  sheet: ImageSize,
  clip: AnimationClip,
  still: ImageSize | null,
): SheetVerdict {
  const layout = sheetLayout(sheet.width, sheet.height, clip.frameCount);
  if (!layout) {
    return {
      ok: false,
      reason:
        `a folha ${sheet.width}×${sheet.height} não se divide em ` +
        `${clip.frameCount} quadros iguais`,
    };
  }
  if (still && (layout.frameWidth !== still.width || layout.frameHeight !== still.height)) {
    return {
      ok: false,
      reason:
        `o quadro da folha (${layout.frameWidth}×${layout.frameHeight}) não bate ` +
        `com o quadro parado (${still.width}×${still.height})`,
    };
  }
  // Sem lateral vertical não há cubo — é losango solto ou textura plana. O
  // mesmo critério de `spriteGeometryFromImage`, repetido aqui para o veredito
  // poder explicar o motivo em vez de devolver um `null` mudo.
  if (layout.frameHeight <= layout.frameWidth / 2) {
    return {
      ok: false,
      reason:
        `o quadro ${layout.frameWidth}×${layout.frameHeight} não tem aresta ` +
        'vertical: não descreve um cubo isométrico',
    };
  }
  return { ok: true, layout };
}

// ------------------------------------------------------------------ o animador

/** Como um bloco mostra um quadro. Injetado por `cube3d.ts` — aqui não há Three.js. */
export type ShowFrame = (frameIndex: number) => void;

interface ClipState {
  readonly clip: AnimationClip;
  readonly show: ShowFrame;
  /** Último quadro efetivamente aplicado. −1 = nenhum ainda. */
  shown: number;
}

/**
 * O relógio dos blocos animados da cena.
 *
 * Um por cena (`scene3d.ts` cria e destrói junto com ela), e não um singleton de
 * módulo: `setActive` é estado da CENA, e duas cenas vivas compartilhando esse
 * conjunto fariam uma apagar a animação da outra.
 *
 * Registrado ≠ ativo. Registrado é "este bloco da paleta sabe animar"; ativo é
 * "este bloco está no mapa agora". Só o segundo mantém o laço de quadro em pé.
 */
export class BlockAnimator {
  private readonly clips = new Map<string, ClipState>();

  private readonly active = new Set<string>();

  private enabled = true;

  /**
   * Instante do primeiro `advance`. A fase é comum a todos os blocos, o que é
   * consequência de compartilharem material — não há como dar fase própria a
   * duas cópias do mesmo bloco sem multiplicar as draw calls.
   */
  private epoch: number | null = null;

  /** Declara que um bloco da paleta sabe animar. */
  register(id: string, clip: AnimationClip, show: ShowFrame): void {
    this.clips.set(id, { clip, show, shown: -1 });
  }

  /**
   * Diz quais blocos estão NO MAPA. Ids desconhecidos são ignorados: a paleta e
   * o mapa mudam por caminhos diferentes e nem sempre na mesma ordem.
   */
  setActive(ids: Iterable<string>): void {
    this.active.clear();
    for (const id of ids) {
      if (this.clips.has(id)) this.active.add(id);
    }
  }

  /**
   * Liga e desliga a animação inteira.
   *
   * Desligar devolve todo mundo ao quadro 0 — o mesmo desenho que o bloco teria
   * sem animação nenhuma. `cube3d.ts` chama isto quando o sistema pede menos
   * movimento (`prefers-reduced-motion`), e é o interruptor que a ADR 0040 exige
   * que exista: nenhum `rAF` fica agendado por causa de animação com ela
   * desligada.
   */
  setEnabled(enabled: boolean): void {
    if (enabled === this.enabled) return;
    this.enabled = enabled;
    if (enabled) return;
    for (const state of this.clips.values()) {
      if (state.shown === 0) continue;
      state.shown = 0;
      state.show(0);
    }
  }

  /** Existe animação viva? É isto que decide se o laço de quadro continua. */
  hasLive(): boolean {
    return this.enabled && this.active.size > 0;
  }

  /**
   * Avança o relógio. Devolve `true` quando algum bloco trocou de quadro — ou
   * seja, quando o desenho vale a pena.
   *
   * A fps do bloco é MUITO menor que a do monitor: a 8 fps a 60 Hz, isto
   * devolve `false` em sete de cada oito chamadas, e o laço agenda o quadro
   * seguinte sem desenhar nada.
   */
  advance(nowMs: number): boolean {
    if (!this.enabled || this.active.size === 0) return false;
    if (this.epoch === null) this.epoch = nowMs;
    const elapsed = nowMs - this.epoch;
    let changed = false;
    for (const id of this.active) {
      const state = this.clips.get(id);
      if (!state) continue;
      const index = frameIndexAt(elapsed, state.clip);
      if (index === state.shown) continue;
      state.shown = index;
      state.show(index);
      changed = true;
    }
    return changed;
  }

  /** Esquece tudo. Chamado ao trocar a paleta e ao destruir a cena. */
  clear(): void {
    this.clips.clear();
    this.active.clear();
    this.epoch = null;
  }
}
