---
name: creating-threejs-cubes
description: How to create BoxGeometry cubes with per-face textures or solid colors — material array, texture loading, procedural fallback, and the face order contract.
metadata:
  type: knowledge
  domain: threejs
  signals:
    - BoxGeometry
    - MeshStandardMaterial
    - MeshLambertMaterial
    - texture per face
    - CanvasTexture
    - cube
  related:
    - bootstrapping-threejs-scene
    - raycasting-threejs-blocks
  verification: src/map/3d/cube3d.ts compiles clean under tsc --noEmit
  version_pin: three@0.185.1
---

# Creating Three.js Cubes with Per-Face Textures

Como criar cubos 3D (BoxGeometry) com texturas ou cores diferentes em cada face, usando material array.

## Ordem das faces no BoxGeometry

O `BoxGeometry` do Three.js cria 6 grupos de material, um por face, nesta ordem:

| Índice | Face | Eixo | Direção |
|--------|------|------|---------|
| 0 | right | +X | leste |
| 1 | left | -X | oeste |
| 2 | top | +Y | cima |
| 3 | bottom | -Y | baixo |
| 4 | front | +Z | sul (frente) |
| 5 | back | -Z | norte (trás) |

Esta ordem É a convenção cubemap `px, nx, py, ny, pz, nz` e é estável desde r125.

## Material array — o contrato

```typescript
import * as THREE from 'three';

// 6 materiais, um por face
const materials: THREE.Material[] = [
  new THREE.MeshLambertMaterial({ color: 0x888888 }), // right (+X)
  new THREE.MeshLambertMaterial({ color: 0x666666 }), // left  (-X)
  new THREE.MeshLambertMaterial({ color: 0xcccccc }), // top   (+Y) — mais clara
  new THREE.MeshLambertMaterial({ color: 0x555555 }), // bottom (-Y)
  new THREE.MeshLambertMaterial({ color: 0x777777 }), // front (+Z)
  new THREE.MeshLambertMaterial({ color: 0x777777 }), // back  (-Z)
];

const geometry = new THREE.BoxGeometry(1, 1, 1);
const cube = new THREE.Mesh(geometry, materials);
scene.add(cube);
```

**Cada material gera um draw call.** Para < 100 cubos isso é aceitável. Para muitos cubos, considerar InstancedMesh com atlas de textura.

## Textura por face

```typescript
const loader = new THREE.TextureLoader();

async function loadFaceTexture(url: string): Promise<THREE.Texture> {
  return new Promise((resolve) => {
    loader.load(url, (tex) => {
      tex.magFilter = THREE.NearestFilter;   // pixel art
      tex.minFilter = THREE.NearestFilter;
      tex.generateMipmaps = false;
      tex.colorSpace = THREE.SRGBColorSpace; // obrigatório desde r152
      resolve(tex);
    });
  });
}

// Exemplo: textura na face frontal, cor nas demais
const faceTex = await loadFaceTexture('/assets/block_north.png');
const materials = [
  new THREE.MeshLambertMaterial({ color: 0x777777 }),  // right
  new THREE.MeshLambertMaterial({ color: 0x555555 }),  // left
  new THREE.MeshLambertMaterial({ color: 0xcccccc }),  // top
  new THREE.MeshLambertMaterial({ color: 0x555555 }),  // bottom
  new THREE.MeshLambertMaterial({ map: faceTex }),     // front — textura!
  new THREE.MeshLambertMaterial({ color: 0x777777 }),  // back
];
```

## Textura procedural (Canvas → Three.js)

Para cubos sem arte gerada, rasteriza-se um canvas 2D e usa-se como textura:

```typescript
function canvasTexture(canvas: HTMLCanvasElement): THREE.Texture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
```

O canvas vem do rasterizador do `iso-core` (`makeCubeCanvasFromHue`, `makeCubeViewsFromHue`).

## Mapeamento BlockDef → faces 3D

O `BlockDef` do editor 2D tem `faceUrls` com 4 direções cardinais (north/east/south/west). No Three.js com a câmera na rotação 0 (sul):

| BlockDef face | BoxGeometry face | Índice |
|---------------|------------------|--------|
| north | front (+Z) | 4 |
| east | right (+X) | 0 |
| south | back (-Z) | 5 |
| west | left (-X) | 1 |

Quando a câmera gira (rotação 1/2/3), as texturas rodam junto: `(facing - rotation) mod 4`.

## Geometria compartilhada

Criar uma `BoxGeometry` por cubo aloca 24 vértices e 36 índices por instância. Para o editor, uma geometria compartilhada (`new THREE.BoxGeometry(1, 1, 1)`) reutilizada em todos os meshes elimina esse custo — cada mesh só aloca seus 6 materiais.

## Iluminação

Usar `MeshLambertMaterial` (não `MeshStandardMaterial`):
- Lambert é mais barato (sem microfacet BRDF)
- A diferença visual em cubos de 1 unidade com luz ambiente + directional é insignificante
- Não requer `environmentMap` para parecer correto

## Referências

- [`src/map/3d/cube3d.ts`](../../tools/character-builder/src/map/3d/cube3d.ts) — implementação completa
- [Three.js BoxGeometry docs](https://threejs.org/docs/#api/en/geometries/BoxGeometry)
- [Three.js Material Array](https://threejs.org/manual/en/textures.html) — "Different Textures on Each Face"
