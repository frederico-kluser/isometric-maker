/**
 * Leitura de atlas no navegador — sem dependência de engine.
 *
 * O `.json` que o `pixellab-pipeline` emite é **TexturePacker JSON Hash**, um
 * formato de dados que nunca foi propriedade de renderizador nenhum. Quem o
 * lia até aqui era o `Assets.load` de uma biblioteca 2D; agora quem lê são
 * estas ~80 linhas, e o resultado é uma `THREE.Texture` por quadro.
 *
 * ## Uma imagem, N texturas, zero cópias
 *
 * Cada quadro é um `clone()` da textura da folha com `repeat`/`offset`
 * apontando para o retângulo do quadro. Clone de textura no Three.js
 * **compartilha a mesma imagem na GPU** — as N texturas de uma animação de 8
 * quadros ocupam o upload de uma folha só, e trocar de quadro não troca de
 * material.
 *
 * ## O eixo V é invertido, e isso não é opcional
 *
 * TexturePacker mede `y` do TOPO da folha para baixo; UV do WebGL mede `v` da
 * BASE para cima. Sem a inversão a animação sai espelhada na vertical e o
 * personagem anda de cabeça para baixo — o tipo de erro que passa por "o
 * atlas está errado" quando é o leitor que está.
 *
 * ## Âncora
 *
 * O `THREE.Sprite` é centrado na origem. `center` é a âncora do sidecar com o
 * mesmo giro de eixo: âncora `{x: 0.5, y: 1}` (pés, o padrão do pipeline) vira
 * `center = (0.5, 0)`.
 */
import * as THREE from 'three';

// ------------------------------------------------------------------ tipos

/** Um quadro no formato TexturePacker JSON Hash. */
export interface AtlasFrameData {
  readonly frame: { x: number; y: number; w: number; h: number };
  readonly sourceSize: { w: number; h: number };
}

/** A folha inteira, como o pipeline a grava. */
export interface AtlasSheetData {
  readonly frames: Record<string, AtlasFrameData>;
  readonly animations: Record<string, readonly string[]>;
  readonly meta: {
    readonly image: string;
    readonly size: { w: number; h: number };
  };
}

/** Um atlas já carregado e pronto para desenhar. */
export interface LoadedAtlas {
  /** Textura por nome de quadro. */
  readonly frames: ReadonlyMap<string, THREE.Texture>;
  /** Quadros de cada animação, na ordem. */
  readonly animations: ReadonlyMap<string, readonly THREE.Texture[]>;
  /** Proporção largura/altura do quadro — o sprite escala por ela. */
  readonly aspect: number;
  /** Libera a textura da folha e todos os clones. */
  dispose(): void;
}

// ------------------------------------------------------------------ carga

/** Ajusta uma textura para pixel art: nada de suavização, nada de mipmap. */
function asPixelArt(tex: THREE.Texture): THREE.Texture {
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

/**
 * Carrega a folha e devolve uma textura por quadro.
 *
 * `sheetUrl` aponta para o `.json`; o PNG vem de `meta.image`, resolvido no
 * mesmo diretório — é assim que o TexturePacker define o campo, e é assim que
 * o pipeline o escreve.
 */
export async function loadAtlas(sheetUrl: string): Promise<LoadedAtlas> {
  const resp = await fetch(sheetUrl);
  if (!resp.ok) throw new Error(`atlas não carregou: ${sheetUrl}`);
  const data = (await resp.json()) as AtlasSheetData;

  const pngUrl = new URL(data.meta.image, new URL(sheetUrl, location.href)).href;
  const base = asPixelArt(await new THREE.TextureLoader().loadAsync(pngUrl));

  const sheetW = data.meta.size.w;
  const sheetH = data.meta.size.h;

  const frames = new Map<string, THREE.Texture>();
  let aspect = 1;
  for (const [name, f] of Object.entries(data.frames)) {
    const tex = base.clone();
    asPixelArt(tex);
    tex.repeat.set(f.frame.w / sheetW, f.frame.h / sheetH);
    // A inversão do V: o topo do quadro em coordenadas de folha é
    // `sheetH − (y + h)` contado de baixo.
    tex.offset.set(f.frame.x / sheetW, (sheetH - f.frame.y - f.frame.h) / sheetH);
    tex.needsUpdate = true;
    frames.set(name, tex);
    if (f.sourceSize.h > 0) aspect = f.sourceSize.w / f.sourceSize.h;
  }

  const animations = new Map<string, readonly THREE.Texture[]>();
  for (const [anim, names] of Object.entries(data.animations ?? {})) {
    const list = names
      .map((n) => frames.get(n))
      .filter((t): t is THREE.Texture => t !== undefined);
    if (list.length > 0) animations.set(anim, list);
  }

  return {
    frames,
    animations,
    aspect,
    dispose(): void {
      for (const t of frames.values()) t.dispose();
      base.dispose();
    },
  };
}
