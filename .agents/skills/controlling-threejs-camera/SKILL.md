---
name: controlling-threejs-camera
description: Pan, zoom, and discrete 90° rotation for an OrthographicCamera in an isometric editor — without OrbitControls.
metadata:
  type: knowledge
  domain: threejs
  signals:
    - OrthographicCamera
    - pan
    - zoom
    - rotation
    - isometric
    - camera controls
  related:
    - bootstrapping-threejs-scene
    - rotating-isometric-camera
  verification: src/map/3d/controls3d.ts compiles clean under tsc --noEmit
  version_pin: three@0.185.1
---

# Controlling Three.js Camera (Isometric Editor)

Como implementar pan, zoom e rotação discreta de 90° para uma OrthographicCamera num editor isométrico, sem usar OrbitControls.

## Câmera isométrica

Posição da câmera para visual 2:1 dimétrico (o mesmo estilo do editor 2D):

```typescript
import * as THREE from 'three';

const ELEVATION = Math.PI / 6;   // 30° do horizonte → proporção ~2:1 no chão
const BASE_YAW = Math.PI / 4;    // 45°
const DISTANCE = 15;

function setCameraRotation(camera: THREE.OrthographicCamera, rotation: 0|1|2|3): void {
  const yaw = BASE_YAW + rotation * (Math.PI / 2);
  
  camera.position.x = DISTANCE * Math.cos(ELEVATION) * Math.sin(yaw);
  camera.position.y = DISTANCE * Math.sin(ELEVATION);
  camera.position.z = DISTANCE * Math.cos(ELEVATION) * Math.cos(yaw);
  
  camera.lookAt(0, 0, 0);
}
```

**30° vs 35.264°:** O ângulo de 35.264° (atan(1/√2)) é o isométrico VERDADEIRO — todos os 3 eixos têm o mesmo foreshortening, e um quadrado no chão projeta como losango √3:1. O visual clássico 2:1 (2 pixels de largura para 1 de altura no losango) requer 30° de elevação.

## Pan

Pan move a câmera no plano perpendicular à direção de visão:

```typescript
function panCamera(camera: THREE.OrthographicCamera, dx: number, dy: number): void {
  // Vetores right e up da câmera no plano de visão
  const right = new THREE.Vector3(
    camera.matrix.elements[0]!,
    camera.matrix.elements[1]!,
    camera.matrix.elements[2]!,
  );
  const up = new THREE.Vector3(
    camera.matrix.elements[4]!,
    camera.matrix.elements[5]!,
    camera.matrix.elements[6]!,
  );
  
  camera.position.addScaledVector(right, -dx);
  camera.position.addScaledVector(up, dy);
}
```

### Convertendo pixels de tela para world units

```typescript
function pixelDeltaToWorld(
  camera: THREE.OrthographicCamera,
  pixelDx: number,
  pixelDy: number,
  viewportW: number,
  viewportH: number,
): { dx: number; dy: number } {
  const frustumHeight = (camera.top - camera.bottom) / camera.zoom;
  const frustumWidth = (camera.right - camera.left) / camera.zoom;
  
  return {
    dx: (pixelDx / viewportW) * frustumWidth,
    dy: (pixelDy / viewportH) * frustumHeight,
  };
}
```

## Zoom

`camera.zoom` multiplica o frustum sem alterar left/right/top/bottom:

```typescript
function zoomCamera(camera: THREE.OrthographicCamera, factor: number): void {
  camera.zoom = Math.max(0.25, Math.min(8, factor));
  camera.updateProjectionMatrix();
}
```

**Zoom inteiro para pixel art.** Fracionário desalinha a grade e produz shimmering. O editor usa passos discretos: 1×, 2×, 3×, 4×.

## Rotação discreta (4 vistas)

O editor suporta 4 vistas separadas por 90° de yaw, como o editor 2D:

- Rotação 0: câmera ao **sul**, olhando para norte
- Rotação 1: câmera ao **leste**, olhando para oeste
- Rotação 2: câmera ao **norte**, olhando para sul
- Rotação 3: câmera ao **oeste**, olhando para leste

A rotação é imediata (sem animação). O `lookAt` sempre aponta para o centro do conteúdo.

## Criação da câmera

```typescript
function createEditorCamera(viewportW: number, viewportH: number): THREE.OrthographicCamera {
  const aspect = viewportW / viewportH;
  const fs = 15; // frustum size — metade da altura visível em world units
  
  const camera = new THREE.OrthographicCamera(
    -fs * aspect, fs * aspect,  // left, right
    fs, -fs,                    // top, bottom
    0.1, 1000,                  // near, far
  );
  
  setCameraRotation(camera, 0); // rotação inicial
  camera.zoom = 1;
  camera.updateProjectionMatrix();
  
  return camera;
}
```

## Armadilha: por que não usar OrbitControls?

`OrbitControls` foi feito para câmeras de inspeção 3D (órbita esférica ao redor de um ponto). Num editor isométrico:

1. A rotação é **discreta** (90°), não contínua
2. O pan é **no plano do chão**, não no plano da tela
3. O zoom é **inteiro** (pixel art)
4. O comportamento de "scroll para zoom, botão do meio para pan, R para girar" é fixo

Implementar controle próprio (~60 linhas) é mais simples que configurar OrbitControls para todos esses comportamentos não-padrão.

## Referências

- [`src/map/3d/controls3d.ts`](../../tools/character-builder/src/map/3d/controls3d.ts) — implementação completa
- [Three.js OrthographicCamera docs](https://threejs.org/docs/#api/en/cameras/OrthographicCamera)
- [Isometric camera with THREE.js — SO](https://stackoverflow.com/questions/23450588) — resposta canônica de WestLangley
