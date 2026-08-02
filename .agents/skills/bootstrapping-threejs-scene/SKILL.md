---
name: bootstrapping-threejs-scene
description: How to set up a Three.js WebGLRenderer scene inside a React component with Vite — renderer, camera, lights, render loop, resize, and cleanup.
metadata:
  type: knowledge
  domain: threejs
  signals:
    - three.js
    - WebGLRenderer
    - OrthographicCamera
    - React + Three.js
    - @types/three
  related:
    - creating-threejs-cubes
    - raycasting-threejs-blocks
    - controlling-threejs-camera
  verification: src/map/3d/scene3d.ts compiles clean under tsc --noEmit
  version_pin: three@0.185.1
---

# Bootstrapping Three.js Scene

Como criar uma cena Three.js dentro de um componente React com Vite + TypeScript.

## Dependências

```json
{
  "dependencies": {
    "three": "0.185.1"
  },
  "devDependencies": {
    "@types/three": "0.185.3"
  }
}
```

**`@types/three` é necessário.** Three.js 0.185 NÃO empacota declarações `.d.ts` no build — o `import * as THREE from 'three'` falha no typecheck sem `@types/three`. O import funciona em runtime (ES module), mas o compilador não encontra os tipos.

## Padrão canônico: React + Three.js

```tsx
import { useCallback, useEffect, useRef } from 'react';
import * as THREE from 'three';

export function ThreeViewport() {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sceneRef = useRef<{ renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.OrthographicCamera } | null>(null);

  // Criação — UMA VEZ, em onMounted
  useEffect(() => {
    const canvas = canvasRef.current;
    const host = hostRef.current;
    if (!canvas || !host) return;
    let disposed = false;

    // 1. Renderer
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x0b1020);

    // 2. Scene
    const scene = new THREE.Scene();

    // 3. Luz
    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const sun = new THREE.DirectionalLight(0xffffff, 0.8);
    sun.position.set(10, 20, 5);
    scene.add(sun);

    // 4. Câmera ortográfica
    const aspect = host.clientWidth / host.clientHeight;
    const frustumSize = 15;
    const camera = new THREE.OrthographicCamera(
      -frustumSize * aspect, frustumSize * aspect,
      frustumSize, -frustumSize,
      0.1, 1000,
    );

    sceneRef.current = { renderer, scene, camera };

    // 5. Render inicial
    resize(renderer, camera, host.clientWidth, host.clientHeight);
    renderer.render(scene, camera);

    return () => {
      disposed = true;
      renderer.dispose();
      scene.clear();
    };
  }, []);

  // Resize via ResizeObserver
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const obs = new ResizeObserver(() => {
      const s = sceneRef.current;
      if (s) resize(s.renderer, s.camera, host.clientWidth, host.clientHeight);
    });
    obs.observe(host);
    return () => obs.disconnect();
  }, []);

  return (
    <div ref={hostRef} className="relative flex-1">
      <canvas ref={canvasRef} className="block size-full" />
    </div>
  );
}

function resize(renderer: THREE.WebGLRenderer, camera: THREE.OrthographicCamera, w: number, h: number) {
  if (w === 0 || h === 0) return;
  renderer.setSize(w, h, false);
  const aspect = w / h;
  const fs = 15;
  camera.left = -fs * aspect;
  camera.right = fs * aspect;
  camera.top = fs;
  camera.bottom = -fs;
  camera.updateProjectionMatrix();
}
```

## Regras

1. **O canvas é um elemento React, a cena NÃO.** Nenhum nó Three.js passa por reconciliação. A cena é criada uma vez e atualizada por chamadas imperativas.

2. **`renderer.dispose()` no cleanup.** Sem isso, cada navegação vaza um contexto WebGL. A ordem é: `dispose()` → `scene.clear()` → remover canvas.

3. **`ResizeObserver` no container, não `window.resize`.** O canvas segue o painel do editor, não a janela.

4. **Sem render loop contínuo.** O editor só desenha quando o estado muda. Um `requestAnimationFrame` contínuo gastaria GPU desenhando frames idênticos.

5. **`renderer.setPixelRatio(Math.min(dpr, 2))`.** Pixel art não se beneficia de dpr > 2, e dpr 3 (celulares) dobra o fill-rate à toa.

6. **`setSize(w, h, false)`** — o terceiro parâmetro `false` impede que o renderer sobrescreva o CSS do canvas.

## Armadilha: `@types/three` é necessário

A pesquisa web afirmou que "tipos são bundled desde r152" — isso NÃO é verdade para Three.js 0.185.1. O pacote npm não inclui arquivos `.d.ts` e o campo `"types"` está ausente do `package.json`. Instale `@types/three` como devDependency.

## Referências

- [`src/map/3d/scene3d.ts`](../../tools/character-builder/src/map/3d/scene3d.ts) — implementação completa no editor
- [`src/map/3d/controls3d.ts`](../../tools/character-builder/src/map/3d/controls3d.ts) — câmera e controles
- [Three.js WebGLRenderer docs](https://threejs.org/docs/#api/en/renderers/WebGLRenderer)
