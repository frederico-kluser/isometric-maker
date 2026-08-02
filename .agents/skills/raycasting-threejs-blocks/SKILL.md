---
name: raycasting-threejs-blocks
description: Minecraft-style block placement with Three.js Raycaster — face detection, adjacent position calculation, ground plane for empty space, and the face normal contract.
metadata:
  type: knowledge
  domain: threejs
  signals:
    - Raycaster
    - face normal
    - block placement
    - Minecraft
    - intersectObjects
    - ground plane
  related:
    - creating-threejs-cubes
    - bootstrapping-threejs-scene
    - editing-isometric-maps
  verification: src/map/3d/pick3d-raycaster.ts compiles clean under tsc --noEmit
  version_pin: three@0.185.1
---

# Raycasting Three.js Blocks (Minecraft-Style)

Como implementar colocação de blocos estilo Minecraft: o mouse intersecta a face de um cubo, e o novo bloco é colocado na célula adjacente.

## O fluxo canônico

```
1. Converte mouse (clientX, clientY) → NDC (normalized device coords)
2. Cria Raycaster com setFromCamera(ndc, camera)
3. intersectObjects(blockMeshes, false) → array ordenado por distância
4. Primeiro hit: hit.object = mesh atingido, hit.face.normal = normal da face
5. Posição adjacente = mesh.position + faceNormal (em world space)
```

## Conversão mouse → NDC

```typescript
function mouseToNDC(clientX: number, clientY: number, canvas: HTMLCanvasElement): THREE.Vector2 {
  const rect = canvas.getBoundingClientRect();
  return new THREE.Vector2(
    ((clientX - rect.left) / rect.width) * 2 - 1,
    -((clientY - rect.top) / rect.height) * 2 + 1,  // Y invertido!
  );
}
```

**O `-` no Y é obrigatório.** O NDC do Three.js tem Y positivo para cima; o DOM tem Y positivo para baixo.

## Detectando a face atingida

```typescript
const raycaster = new THREE.Raycaster();
raycaster.setFromCamera(ndc, camera);
const hits = raycaster.intersectObjects(blockMeshes, false);

if (hits.length > 0) {
  const hit = hits[0];                        // mais próximo
  const mesh = hit.object as THREE.Mesh;      // o cubo atingido
  const faceNormal = hit.face!.normal.clone(); // normal da face (local space)
  
  // Converter para world space (essencial se os cubos tiverem rotação)
  faceNormal.transformDirection(mesh.matrixWorld);
  
  // Arredondar para direção cardeal
  const dir = new THREE.Vector3(
    Math.round(faceNormal.x),
    Math.round(faceNormal.y),
    Math.round(faceNormal.z),
  );
  
  // Posição adjacente = posição do cubo + normal
  const adjacentPos = mesh.position.clone().add(dir);
}
```

## `face.normal` é em espaço LOCAL

`hit.face.normal` é a normal da face no espaço local da geometria. Para cubos não-rotacionados (nosso caso), local == world. Para segurança, sempre use `transformDirection(mesh.matrixWorld)` — é idempotente em cubos não-rotacionados.

## Clique no espaço vazio (ground plane)

Quando o raio não acerta nenhum cubo, intersectamos um plano invisível no chão:

```typescript
// Criação (uma vez):
const groundPlane = new THREE.Mesh(
  new THREE.PlaneGeometry(20, 20),
  new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide }),
);
groundPlane.rotation.x = -Math.PI / 2; // deita no plano XZ
groundPlane.name = 'ground-plane';

// No picking:
if (hits.length === 0) {
  const groundHits = raycaster.intersectObject(groundPlane);
  if (groundHits.length > 0) {
    const point = groundHits[0].point;
    const cell = {
      x: Math.round(point.x),
      y: Math.round(point.z),  // Z do Three.js → Y do mapa
      z: 0,                     // chão
    };
    return { hit: null, placement: cell };
  }
}
```

## Sistema de coordenadas

O mapa usa (x, y, z) onde z é altura. O Three.js usa (X, Y, Z) onde Y é altura. O mapeamento é:

```
Mapa → Three.js:  position(x, z, y)
Three.js → Mapa:  cell = { x: round(pos.x), y: round(pos.z), z: round(pos.y) }
```

## Armadilhas

1. **IntersectObjects requer array mutável.** `raycaster.intersectObjects` tem assinatura `Object3D[]`, não `readonly Object3D[]`. Fazer `as unknown as THREE.Object3D[]` quando passar arrays readonly.

2. **Arestas e cantos.** Quando o raio atinge exatamente uma aresta, `face.normal` pode vir de qualquer uma das faces adjacentes. O comportamento é determinístico mas não intuitivo. Aceitar sem tratamento especial.

3. **DoubleSide.** Se usar `DoubleSide` nos materiais, os normais podem vir invertidos. Manter `FrontSide` (o default) evita surpresa.

4. **Preview no mesmo lugar que o bloco.** O cubo de preview deve ter `depthTest: true` e `depthWrite: false` para não bloquear o raycasting do frame seguinte.

## Referências

- [`src/map/3d/pick3d-raycaster.ts`](../../tools/character-builder/src/map/3d/pick3d-raycaster.ts) — implementação completa
- [Three.js Raycaster docs](https://threejs.org/docs/#api/en/core/Raycaster)
- [SO: Obtaining normal of mesh face using raycaster](https://stackoverflow.com/questions/21644869)
