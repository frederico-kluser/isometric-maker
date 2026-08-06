/**
 * Fábrica de cubos 3D para o editor Three.js.
 *
 * **Uma sprite por bloco. A mesma, esticada sobre as três faces visíveis.**
 *
 * Não há textura por face, não há quatro vistas, não há recorte da arte em três
 * imagens. O bloco tem UMA sprite isométrica — a mesma que o editor 2D
 * desenharia inteira na célula — e o `BoxGeometry` recebe UVs que fazem cada
 * face samplear a região da sprite que lhe corresponde: o losango do topo na
 * face +Y, o paralelogramo esquerdo em +Z, o direito em +X.
 *
 * ## Por que isso reproduz a arte, e não uma versão dela
 *
 * A câmera é ortográfica com yaw 45° e elevação 30°, que é exatamente a
 * projeção 2:1 em que a sprite foi desenhada (a derivação está em
 * `packages/iso-core/src/iso-cube-uv.ts`). Cada face do cubo projeta num
 * paralelogramo, e paralelogramo é imagem afim de quadrado — o mapeamento
 * canto-a-canto é exato nos dois triângulos do quad, sem cisalhamento e sem
 * costura na diagonal.
 *
 * ## As faces escondidas não existem para o olho
 *
 * O mesh gira junto com a câmera (`scene3d.ts`, `applyCubeYaw`): o cubo é
 * simétrico sob 90° em Y, então girá-lo com a câmera devolve o cubo ao mesmo
 * lugar no mundo e mantém +X, +Y e +Z sempre de frente. −X, −Y e −Z nunca
 * aparecem, em nenhuma das quatro vistas nem durante o giro animado. Elas
 * recebem UV pela mesma fórmula (espelhado), o que é irrelevante e mais barato
 * que ramificar.
 *
 * ## Sem iluminação nas faces, por decisão
 *
 * `MeshBasicMaterial`, não `MeshLambertMaterial`. A pixel art já tem o
 * sombreamento assado — topo claro, direita média, esquerda escura, a convenção
 * que `packages/iso-core/src/cube-raster.ts` declara como "a luz é presa à
 * CÂMERA". Iluminar por cima disso escurece a arte duas vezes e, pior, faz a
 * mesma peça mudar de cor ao girar a câmera, que se lê como bug. A sombra
 * projetada continua existindo — ela cai no CHÃO, ver `grid3d.ts`.
 *
 * ## Sombra entre cubos — o quad `ShadowMaterial`
 *
 * O chão recebe sombra via um plano `ShadowMaterial` (`grid3d.ts`). Para cubos
 * empilhados, cada cubo ganha um quad filho com `ShadowMaterial` logo acima da
 * face +Y (topo). Ele amostra o shadow map da mesma luz que o chão e escurece
 * onde um cubo superior projeta sombra — sem tocar na pixel art do cubo, sem
 * acender luzes e sem invalidar o laço render-on-demand. Geometria e material
 * são compartilhados entre todos os cubos.
 *
 * ## O bloco animado (ADR 0032), que até 2026-08-04 não animava
 *
 * A técnica `texture` grava UMA folha horizontal com todos os quadros
 * (`spritesheet.png`) e um sidecar com fps, contagem e vai-e-volta. Esses campos
 * atravessavam o catálogo, o `blocks-api.ts` e o `BlockDef` inteiros e morriam
 * aqui: `spriteCandidates` nunca listou `spritesheetUrl`, então o mapa desenhava
 * o `base.png` — um quadro parado de uma animação que foi paga.
 *
 * Agora a folha vira UMA textura com `repeat.x = 1/n`, e trocar de quadro é
 * mexer no `offset.x`. Não há troca de material, não há recompilação de shader e
 * não há UV novo: a geometria é a mesma, compartilhada por proporção, medida do
 * QUADRO (não da folha). A aritmética — qual quadro no instante t, o vai-e-volta,
 * e se a folha descreve mesmo este cubo — mora em `block-animation.ts`, que é
 * puro e testado; aqui fica só o que precisa de GPU.
 *
 * Quem chama `advance` é o laço único da cena (`scene3d.ts`), que continua
 * parando sozinho quando não há bloco animado no mapa (ADR 0040).
 */
import * as THREE from 'three';
import {
  CANONICAL_CUBE,
  silhouetteMatch,
  type IsoCubeGeometry,
} from '../../../../../packages/iso-core/src/iso-cube.ts';
import {
  cornerOfLocalPosition,
  cornerSpriteUv,
  spriteGeometryFromImage,
  spriteStretchError,
} from '../../../../../packages/iso-core/src/iso-cube-uv.ts';
import { makeCubeViewsFromHue } from './cube-canvas.ts';
import {
  animationClipOf,
  checkSheet,
  frameOffsetU,
  frameRepeatU,
  type AnimationClip,
  type ShowFrame,
} from './block-animation.ts';
import type { BlockDef } from './block-def.ts';

// ------------------------------------------------------------------ constantes

/** Tamanho do cubo em world units. 1 = 1 tile de lado. */
const CUBE_SIZE = 1;

/**
 * Alfa mínimo para o pixel ser desenhado.
 *
 * `alphaTest` em vez de `transparent`: a arte gerada nem sempre preenche a
 * silhueta inteira, e sem recorte o pixel vazio apareceria como borda preta.
 * Com `transparent: false` o cubo continua no passe opaco — sem ordenação por
 * profundidade e sem o custo de blend.
 */
const ALPHA_TEST = 0.5;

/** Matiz do bloco sem arte nem matiz declarado. Cinza-azulado neutro. */
const DEFAULT_HUE = 210;

/**
 * Opacidade da sombra entre cubos. Mesmo valor do chão (`grid3d.ts`) para
 * consistência visual — a sombra que um cubo projeta no bloco de baixo tem a
 * mesma intensidade da sombra que ele projeta no chão.
 */
const CUBE_SHADOW_OPACITY = 0.42;

/**
 * Altura do quad de sombra acima da face +Y. Suficiente para evitar z-fighting
 * sem descolar visualmente do topo do cubo.
 */
export const SHADOW_QUAD_EPS = 0.001;

// ------------------------------------------------------------------ quad de sombra por cubo

/** Geometria compartilhada do quad de sombra — um quadrado 1×1 no plano XZ. */
let _sharedShadowQuadGeom: THREE.PlaneGeometry | null = null;

/** Material compartilhado do quad de sombra — `ShadowMaterial` com opacidade fixa. */
let _sharedShadowQuadMat: THREE.ShadowMaterial | null = null;

/**
 * Cria (ou devolve do cache) o quad `ShadowMaterial` que recebe sombra no topo
 * do cubo.
 *
 * Geometria e material são compartilhados entre TODOS os cubos — o quad só existe
 * para amostrar o shadow map, e a posição world-space de cada um é dada pela
 * hierarquia do grafo de cena (o quad é filho do mesh do cubo).
 */
export function createCubeShadowQuad(): THREE.Mesh {
  if (!_sharedShadowQuadGeom) {
    _sharedShadowQuadGeom = new THREE.PlaneGeometry(1, 1);
  }
  if (!_sharedShadowQuadMat) {
    _sharedShadowQuadMat = new THREE.ShadowMaterial({
      color: 0x000000,
      opacity: CUBE_SHADOW_OPACITY,
      // depthWrite desligado: onde não há sombra o quad é transparente, e
      // escrever profundidade faria ele ocluir o grid e os cubos atrás.
      depthWrite: false,
    });
  }
  const quad = new THREE.Mesh(_sharedShadowQuadGeom, _sharedShadowQuadMat);
  // PlaneGeometry nasce no plano XY (normal +Z). Girar −90° em X deita no
  // plano XZ (normal +Y), que é o topo do cubo.
  quad.rotation.x = -Math.PI / 2;
  quad.receiveShadow = true;
  quad.renderOrder = 1; // mesma ordem do catcher do chão
  return quad;
}

// ------------------------------------------------------------------ geometria com UV de sprite

/**
 * Cache das geometrias por proporção de sprite.
 *
 * A chave é `largura×altura` da imagem: dois blocos com sprites do mesmo
 * tamanho compartilham a geometria inteira, porque o UV depende só da
 * proporção — não da arte.
 */
const geometryCache = new Map<string, THREE.BoxGeometry>();

/**
 * `BoxGeometry(1,1,1)` com o UV reescrito para a sprite isométrica.
 *
 * O UV de cada vértice sai da POSIÇÃO dele, não do UV default do `BoxGeometry`.
 * Isso importa: o UV default depende da ordem em que o three.js emite os
 * vértices de cada face, que é detalhe interno da biblioteca; a posição é a
 * geometria. Um vértice em (+0.5, +0.5, +0.5) é o canto da frente do topo em
 * qualquer versão, e é lá que fica o vinco entre as duas laterais da sprite.
 *
 * Os 24 vértices (4 por face, não compartilhados) são percorridos uma vez. Os
 * três vértices que ocupam o mesmo canto — um por face vizinha — recebem o
 * MESMO UV, porque as três faces se encontram num único pixel da sprite. É essa
 * coincidência que faz as arestas do cubo casarem com as arestas desenhadas.
 */
function spriteGeometry(geom: IsoCubeGeometry): THREE.BoxGeometry {
  const key = `${geom.spriteWidth}x${geom.spriteHeight}`;
  const cached = geometryCache.get(key);
  if (cached) return cached;

  const geo = new THREE.BoxGeometry(CUBE_SIZE, CUBE_SIZE, CUBE_SIZE);
  const position = geo.getAttribute('position');
  const uv = geo.getAttribute('uv');
  for (let i = 0; i < position.count; i += 1) {
    const corner = cornerOfLocalPosition(
      position.getX(i),
      position.getY(i),
      position.getZ(i),
    );
    const { u, v } = cornerSpriteUv(corner, geom);
    uv.setXY(i, u, v);
  }
  uv.needsUpdate = true;

  geometryCache.set(key, geo);
  return geo;
}

// ------------------------------------------------------------------ texturas

/** Configuração de textura para pixel art: nada de suavização, nada de mipmap. */
function asPixelArt(tex: THREE.Texture): THREE.Texture {
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

/** Cache de imagens por URL — a mesma sprite serve vários blocos. */
const imageLoads = new Map<string, Promise<HTMLImageElement | null>>();

/**
 * Carrega uma imagem. Devolve `null` em vez de rejeitar: uma sprite que não
 * carrega é um bloco procedural, não um editor quebrado.
 */
function loadImage(url: string): Promise<HTMLImageElement | null> {
  const cached = imageLoads.get(url);
  if (cached) return cached;
  const promise = new Promise<HTMLImageElement | null>((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
  imageLoads.set(url, promise);
  return promise;
}

// ------------------------------------------------------------------ escolha da vista canônica

/** Canal alfa de uma imagem, linha a linha. `null` se o canvas não abrir. */
function alphaOf(img: HTMLImageElement): Uint8Array | null {
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (ctx === null) return null;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const alpha = new Uint8Array(canvas.width * canvas.height);
  for (let i = 0; i < alpha.length; i += 1) alpha[i] = data[i * 4 + 3] ?? 0;
  return alpha;
}

/**
 * Escolhe, entre várias candidatas, a que É um cubo isométrico de três faces.
 *
 * Os blocos gerados por `/rotate` gravam oito vistas e declaram no manifesto
 * `frameKeying: "assumed-canonical-order"` — ninguém verificou qual índice é a
 * vista de três faces. Quatro delas são a vista de quina (o cubo de frente,
 * duas faces), e usar uma dessas como sprite pinta o bloco com a arte errada,
 * esticada sobre uma geometria que ela não descreve.
 *
 * A escolha é MEDIDA, não assumida: `silhouetteMatch` compara o alfa de cada
 * candidata com a silhueta que `faceAtPixel` define, e a de maior score vence.
 * Na arte deste repositório a vencedora é a `view-7` em 5 dos 6 blocos — o que
 * confirma que a ordem assumida (`view-0` primeiro) estava errada.
 *
 * Com uma candidata só, nem abre canvas: não há o que comparar.
 */
async function pickCanonicalSprite(
  urls: readonly string[],
): Promise<{ url: string; image: HTMLImageElement } | null> {
  const loaded = (
    await Promise.all(
      urls.map(async (url) => {
        const image = await loadImage(url);
        return image ? { url, image } : null;
      }),
    )
  ).filter((c): c is { url: string; image: HTMLImageElement } => c !== null);
  if (loaded.length === 0) return null;
  if (loaded.length === 1) return loaded[0]!;

  let best: { url: string; image: HTMLImageElement } | null = null;
  let bestScore = -Infinity;
  for (const candidate of loaded) {
    const { image } = candidate;
    const geom = spriteGeometryFromImage(image.naturalWidth, image.naturalHeight);
    if (!geom) continue;
    const alpha = alphaOf(image);
    if (!alpha) continue;
    const { score } = silhouetteMatch(
      alpha,
      image.naturalWidth,
      image.naturalHeight,
      geom,
    );
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best ?? loaded[0]!;
}

/** Memoriza a escolha por bloco — a miniatura e o cubo têm de concordar. */
const chosenSprite = new Map<string, Promise<string | null>>();

/**
 * A URL da sprite que o cubo deste bloco vai mostrar.
 *
 * A paleta usa isto na miniatura. Antes ela adivinhava a URL por conta própria
 * e errava justamente nos blocos de várias vistas — a miniatura mostrava um
 * quadrado colorido enquanto o cubo mostrava a arte. Uma pergunta, uma
 * resposta, os dois lugares.
 */
export function canonicalSpriteUrl(block: BlockDef): Promise<string | null> {
  const cached = chosenSprite.get(block.id);
  if (cached) return cached;
  const urls = spriteCandidates(block);
  const promise =
    urls.length === 0
      ? Promise.resolve(null)
      : pickCanonicalSprite(urls).then((c) => c?.url ?? null);
  chosenSprite.set(block.id, promise);
  return promise;
}

// ------------------------------------------------------------------ arte do cubo

/**
 * O que a cena precisa para animar um bloco.
 *
 * `show` já está amarrado à textura deste bloco — o animador não conhece
 * Three.js e não precisa conhecer.
 */
export interface CubeAnimation {
  readonly clip: AnimationClip;
  readonly show: ShowFrame;
}

/** Tudo que um cubo precisa para existir: uma geometria e um material. */
export interface CubeArt {
  /** Material único — as seis faces usam o mesmo; o UV é que difere. */
  readonly material: THREE.Material;
  /** Geometria compartilhada com UV de sprite. Não dar dispose por mesh. */
  readonly geometry: THREE.BufferGeometry;
  /** false = arte procedural (o bloco não tem sprite gerada). */
  readonly hasSprite: boolean;
  /**
   * Quanto a sprite se afasta da proporção de um cubo perfeito (0 = exata).
   * Fica registrado para diagnóstico: arte muito fora aparece esticada, e saber
   * disso evita atribuir à geração o que é proporção.
   */
  readonly stretch: number;
  /** Presente só no bloco que anima de verdade. Ausente = quadro parado. */
  readonly animation?: CubeAnimation | undefined;
}

/**
 * As URLs candidatas a sprite PARADA de um bloco, em ordem de preferência.
 *
 * `spriteUrls` (as oito vistas do `/rotate`) vem primeiro porque é a única
 * fonte com mais de uma candidata — e portanto a única que precisa da escolha
 * por silhueta. Os demais caminhos têm uma imagem só.
 *
 * **`spritesheetUrl` não entra nesta lista, e isso é decisão.** A folha não é
 * uma candidata a sprite: ela é uma TIRA de n quadros, e enfiá-la aqui pintaria
 * o cubo com a fileira inteira espremida. O caminho animado (`createAnimatedArt`)
 * é separado, e o resultado desta função é justamente o que ele usa como quadro
 * parado — para conferir a folha e para degradar quando ela não serve.
 */
function spriteCandidates(block: BlockDef): readonly string[] {
  if (block.spriteUrls && block.spriteUrls.length > 0) return block.spriteUrls;
  if (block.faceUrls) return [block.faceUrls.north];
  if (block.baseUrl) return [block.baseUrl];
  if (block.hash) return [`/world-blocks/${block.hash}/base.png`];
  return [];
}

/**
 * Monta a arte ANIMADA de um bloco a partir da folha, ou `null` quando não dá.
 *
 * `null` não é falha: é a resposta certa para bloco sem folha, bloco de um
 * quadro só, folha que não carrega e folha que discorda do quadro parado. Em
 * todos esses casos quem desenha é o caminho normal, com a imagem estática — o
 * mapa continua funcionando.
 *
 * A geometria sai do QUADRO, nunca da folha: uma tira de 9 quadros de 48×53 é
 * 432×53, e `spriteGeometryFromImage(432, 53)` descreveria um cubo achatado
 * absurdo. Medido o quadro, o bloco animado cai na MESMA chave de cache de
 * geometria (`48x53`) que o bloco parado — nenhuma geometria a mais na memória.
 *
 * `alphaTest` continua valendo: os quadros vêm com `no_background` e a silhueta
 * do cubo não preenche o retângulo do quadro.
 */
async function createAnimatedArt(
  block: BlockDef,
  still: HTMLImageElement | null,
): Promise<CubeArt | null> {
  const clip = animationClipOf(block);
  const url = block.spritesheetUrl;
  if (!clip || url === undefined || url === '') return null;

  const sheet = await loadImage(url);
  if (!sheet) {
    console.warn(
      `[cubo 3d] ${block.id}: a folha ${url} não carregou — desenhando o quadro parado.`,
    );
    return null;
  }

  const verdict = checkSheet(
    { width: sheet.naturalWidth, height: sheet.naturalHeight },
    clip,
    still ? { width: still.naturalWidth, height: still.naturalHeight } : null,
  );
  if (!verdict.ok) {
    console.warn(`[cubo 3d] ${block.id}: ${verdict.reason} — desenhando o quadro parado.`);
    return null;
  }

  const geom = spriteGeometryFromImage(
    verdict.layout.frameWidth,
    verdict.layout.frameHeight,
  );
  if (!geom) return null;

  const texture = asPixelArt(new THREE.Texture(sheet));
  // A janela da textura é UM quadro. O UV que a geometria escreve continua indo
  // de 0 a 1; é a matriz da textura que o traduz para dentro do quadro corrente.
  texture.repeat.set(frameRepeatU(clip.frameCount), 1);
  texture.offset.set(0, 0);
  texture.needsUpdate = true;

  return {
    material: new THREE.MeshBasicMaterial({
      map: texture,
      alphaTest: ALPHA_TEST,
    }),
    geometry: spriteGeometry(geom),
    hasSprite: true,
    stretch: spriteStretchError(geom),
    animation: {
      clip,
      show: (index: number): void => {
        texture.offset.x = frameOffsetU(index, clip.frameCount);
      },
    },
  };
}

/**
 * Monta a arte de um bloco: folha animada quando existe e serve, sprite gerada
 * quando existe, cubo procedural quando não há nenhuma das duas.
 *
 * O caminho é praticamente UM só. Antes havia três (quatro faces, textura
 * única, procedural) e eles discordavam sobre o que é a arte de um bloco — o de
 * textura única colava a sprite isométrica inteira em cada face lateral, que é o
 * defeito que esta reescrita corrigiu. Hoje todo bloco é uma sprite isométrica
 * sobre a mesma geometria; o que muda é a origem da imagem — o PNG parado, a
 * janela sobre a folha, ou o rasterizador do iso-core.
 *
 * A sprite parada é escolhida SEMPRE, mesmo em bloco animado: ela é a miniatura
 * da paleta (`canonicalSpriteUrl`), é a régua que confere a folha, e é o que
 * sobra quando a folha não serve.
 */
export async function createCubeArt(block: BlockDef): Promise<CubeArt> {
  const chosen = await pickCanonicalSprite(spriteCandidates(block));
  if (chosen) chosenSprite.set(block.id, Promise.resolve(chosen.url));

  const animated = await createAnimatedArt(block, chosen?.image ?? null);
  if (animated) return animated;

  if (chosen) {
    const img = chosen.image;
    const geom = spriteGeometryFromImage(img.naturalWidth, img.naturalHeight);
    if (geom) {
      const texture = asPixelArt(new THREE.Texture(img));
      texture.needsUpdate = true;
      return {
        material: new THREE.MeshBasicMaterial({
          map: texture,
          alphaTest: ALPHA_TEST,
        }),
        geometry: spriteGeometry(geom),
        hasSprite: true,
        stretch: spriteStretchError(geom),
      };
    }
    // Imagem que não é um cubo isométrico (textura plana, losango solto):
    // cai no procedural em vez de esticar arte que não descreve um volume.
  }
  return proceduralArt(block.hue ?? DEFAULT_HUE);
}

/**
 * O sistema pediu menos movimento?
 *
 * `prefers-reduced-motion` é o interruptor que a ADR 0040 exige que exista: com
 * ele ligado nenhum `rAF` fica agendado por causa de animação, e o bloco fica no
 * quadro 0 — exatamente como era antes desta onda. Fora do navegador (ou num
 * navegador sem `matchMedia`) a resposta é `false`: o default é animar.
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Cache do cubo procedural por matiz — o rasterizador é caro para repetir. */
const proceduralCache = new Map<number, CubeArt>();

/**
 * Cubo desenhado por código, na MESMA forma e no mesmo caminho da arte gerada.
 *
 * O rasterizador do iso-core devolve a sprite isométrica canônica (48×53) com o
 * sombreamento das três faces já assado. Ou seja: o bloco procedural não é um
 * caso especial do renderizador — é a mesma sprite única, com outra origem.
 */
function proceduralArt(hue: number): CubeArt {
  const cached = proceduralCache.get(hue);
  if (cached) return cached;
  // Vista 0 das quatro: o desenho do material muda entre elas, o tom das faces
  // não. Como a sprite é uma só, qualquer uma serve — a 0 é a canônica.
  const canvas = makeCubeViewsFromHue(hue, CANONICAL_CUBE)[0]!;
  const texture = asPixelArt(new THREE.CanvasTexture(canvas));
  const art: CubeArt = {
    material: new THREE.MeshBasicMaterial({
      map: texture,
      alphaTest: ALPHA_TEST,
    }),
    geometry: spriteGeometry(CANONICAL_CUBE),
    hasSprite: false,
    stretch: 0,
  };
  proceduralCache.set(hue, art);
  return art;
}

// ------------------------------------------------------------------ criação de mesh

/**
 * Cria o mesh de um cubo.
 *
 * `castShadow` sim: o cubo projeta sombra no chão e nos cubos abaixo.
 * `receiveShadow` não: o material é `MeshBasicMaterial`, que ignora shadow map.
 * Quem recebe a sombra de cubos superiores é o quad `ShadowMaterial` filho,
 * ancorado logo acima da face +Y — o mesmo truque de desacoplamento que o chão
 * usa (`grid3d.ts`).
 */
export function createCubeMesh(art: CubeArt): THREE.Mesh {
  const mesh = new THREE.Mesh(art.geometry, art.material);
  mesh.castShadow = true;
  mesh.receiveShadow = false;

  // Quad filho que recebe sombra de cubos acima. Geometria e material são
  // compartilhados: um draw call a mais por cubo, sem alocação extra.
  const shadowQuad = createCubeShadowQuad();
  shadowQuad.position.y = CUBE_SIZE / 2 + SHADOW_QUAD_EPS;
  mesh.add(shadowQuad);

  return mesh;
}

// ------------------------------------------------------------------ cubo de preview

let previewBox: THREE.BoxGeometry | null = null;

/**
 * Cubo de preview semitransparente.
 *
 * Azul para colocação, vermelho para remoção. Geometria levemente maior
 * para evitar z-fighting com o cubo existente.
 *
 * `depthWrite: false` é obrigatório: escrevendo profundidade, o preview
 * apareceria como oclusor do raycast do quadro seguinte.
 */
export function createPreviewMesh(invalid: boolean): THREE.Mesh {
  if (!previewBox) {
    previewBox = new THREE.BoxGeometry(1.01, 1.01, 1.01);
  }
  const color = invalid ? 0xef4444 : 0x3b82f6;
  const mat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.4,
    depthTest: true,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(previewBox, mat);
  mesh.renderOrder = 5;
  return mesh;
}

// ------------------------------------------------------------------ highlight

let highlightEdges: THREE.EdgesGeometry | null = null;

/**
 * Contorno de seleção (edge highlight).
 *
 * A `EdgesGeometry` é calculada UMA vez e compartilhada. Recriá-la por quadro —
 * como era feito antes — recalculava as arestas do cubo a cada movimento do
 * mouse, no thread principal.
 */
export function createHighlightMesh(): THREE.LineSegments {
  if (!highlightEdges) {
    const box = new THREE.BoxGeometry(1.02, 1.02, 1.02);
    highlightEdges = new THREE.EdgesGeometry(box);
    box.dispose();
  }
  const mat = new THREE.LineBasicMaterial({
    color: 0x38bdf8,
    transparent: true,
    opacity: 0.9,
    depthTest: true,
  });
  const lines = new THREE.LineSegments(highlightEdges, mat);
  lines.renderOrder = 6;
  return lines;
}

// ------------------------------------------------------------------ limpeza

/**
 * Descarta os caches do módulo. Chamar ao destruir a cena.
 *
 * As geometrias e os materiais procedurais são compartilhados entre cenas e
 * entre blocos; quem cria não é quem remove, então a liberação é aqui e não no
 * mesh.
 */
export function disposeCubeCache(): void {
  for (const geo of geometryCache.values()) geo.dispose();
  geometryCache.clear();
  for (const art of proceduralCache.values()) {
    const mat = art.material as THREE.MeshBasicMaterial;
    mat.map?.dispose();
    mat.dispose();
  }
  proceduralCache.clear();
  imageLoads.clear();
  chosenSprite.clear();
  if (previewBox) {
    previewBox.dispose();
    previewBox = null;
  }
  if (highlightEdges) {
    highlightEdges.dispose();
    highlightEdges = null;
  }
  if (_sharedShadowQuadGeom) {
    _sharedShadowQuadGeom.dispose();
    _sharedShadowQuadGeom = null;
  }
  if (_sharedShadowQuadMat) {
    _sharedShadowQuadMat.dispose();
    _sharedShadowQuadMat = null;
  }
}
