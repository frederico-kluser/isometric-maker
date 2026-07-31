# Handoff: F4-01, F4-02, F4-03 — Runtime (G-runtime)

**Onda:** G · **Data:** 2026-08-03

## Cartas executadas

| Card | Módulo | Descrição |
|------|--------|-----------|
| F4-01 | `tools/runtime/` | Scaffold do runtime e carregamento do artefato |
| F4-02 | `tools/runtime/src/` | Runtime desenha e simula |
| F4-03 | `scripts/` | Verificador da fronteira do runtime |

---

## F4-01 — Scaffold do runtime e carregamento

### Arquivos

- `tools/runtime/package.json` — pixi.js 8.19.0, @isometric-maker/iso-core, vite, tsx
- `tools/runtime/tsconfig.json` — estrito, bundler, DOM, Node types
- `tools/runtime/index.html` — página HTML mínima
- `tools/runtime/vite.config.ts` — config de referência (o servidor é criado programaticamente)
- `tools/runtime/src/load.ts` — `loadRuntimeProject(projectPath)`
- `tools/runtime/src/play.ts` — CLI `npm run play -- <project.json>`

### API pública

```ts
// load.ts
export interface RuntimeProject {
  readonly project: ProjectV1;
  readonly projectDir: string;
  readonly atlasSidecars: readonly string[];
  readonly atlasSheets: readonly string[];
}
export async function loadRuntimeProject(projectPath: string): Promise<RuntimeProject>
```

### Decisões de design

1. **Servidor Vite programático.** `play.ts` cria o Vite dev server com um plugin que injecta os dados do projecto via `GET /__project__.json` e serve os ficheiros de atlas via `GET /__atlas__/*`. Isto mantém a lógica de carregamento em Node.js (onde `loadProject` funciona) e o browser recebe os dados já validados.

2. **Sidecar definido inline.** O tipo `SidecarMin` está definido em `play.ts`, não importado de `pixellab-pipeline`. A regra da fronteira (F4-03) proíbe imports de `tools/` no runtime.

3. **Atlas validados antes de arrancar.** `loadRuntimeProject` verifica que cada sidecar `.pixellab.json` e cada spritesheet `.json` existe ANTES de abrir o navegador. Se algum faltar, o processo termina com erro.

4. **Sem argumento → erro.** `play.ts` imprime o uso e sai com código 1 quando executado sem o caminho do projecto.

5. **Spritesheet derivado do sidecar.** Para cada `criatura.pixellab.json`, o loader espera um `criatura.json` no mesmo directório. Esta é a convenção do `packGrid` no pipeline.

### Limitações conhecidas

- O servidor Vite serve ficheiros do directório do projecto via rewrite de URL. O `server.fs.allow` está configurado para permitir acesso. Em ambientes com symlinks ou mounts complexos, pode ser necessário ajustar.
- O `open: true` no Vite abre o navegador automaticamente; se falhar, o URL é impresso no terminal.
- Não há hot reload das alterações ao projecto — o servidor carrega o projecto uma vez no arranque.

---

## F4-02 — Runtime desenha e simula

### Arquivos

- `tools/runtime/src/main.ts` — Ponto de entrada do browser: inicializa PixiJS, loop de jogo, entrada de teclado
- `tools/runtime/src/render.ts` — Renderizador isométrico: mapa, personagem, FPS

### API pública

```ts
// render.ts
export interface RenderContext { app, geom, mapLayer, entityLayer }
export interface CharacterRender { sprite, sidecarFps, currentAnim, facing }
export interface FpsCounter { frames, lastTime, fps, drawCalls }

export function createRenderContext(app: Application, geom: ProjectGeometry): RenderContext
export function drawMap(ctx: RenderContext, mapa: MapData): void
export function createCharacterRender(sheetUrl: string, sidecar: SidecarMin): Promise<CharacterRender>
export function updateCharacterAnim(char: CharacterRender, state: MovementState): void
export function positionCharacter(sprite: AnimatedSprite, x, y, z, geom: ProjectGeometry): void
export function createFpsCounter(): FpsCounter
export function updateFps(counter: FpsCounter, renderer: Renderer): void
```

### Decisões de design

1. **Mapa com ordenação de profundidade (F2-03).** `drawMap` recolhe todos os blocos e arestas, aplica `sortByDepth` do iso-core, e desenha na ordem correcta. Blocos são losangos coloridos (cores por tipo de bloco); arestas são linhas castanhas.

2. **Personagem com âncora medida.** `createCharacterRender` lê o `sidecar.anchor` e aplica-o ao `AnimatedSprite`. O `anchorSource` não é usado — a âncora é sempre aplicada.

3. **Animações ao fps do sidecar.** `animationSpeed = fps / 60`, onde `fps` vem do sidecar. A troca de animação (`updateCharacterAnim`) selecciona a combinação `acção_direcção` com base no estado de movimento e na orientação.

4. **Passo fixo de lógica (F3-01).** O loop de jogo chama `step()` do iso-core com o `dt` real. A posição de desenho é interpolada entre o estado anterior e o actual com base no acumulador.

5. **Interpolação só no desenho.** A posição do sprite é interpolada (`prevPos + (currPos - prevPos) * alpha`), mas o modelo de movimento é actualizado em passos discretos.

6. **Entrada de teclado.** Setas/WASD para movimento, Espaço para pulo, E para subir degrau, Q para descer degrau. A direcção é normalizada. `preventDefault` nas setas e espaço evita scroll da página.

7. **FPS e draw calls no console.** A cada segundo, imprime `FPS: N | Draw Calls: M`. Os draw calls vêm do `renderer` do PixiJS 8.

8. **Câmara segue o personagem.** `positionStage` centra o stage no ecrã com base na posição do personagem.

### Limitações conhecidas

- **Tiles são losangos coloridos, não sprites.** O runtime actual não carrega um atlas de tiles — desenha blocos como geometria vectorial. Quando o map-builder gerar tilesets, o renderizador precisará de ser estendido para usar texturas.
- **Apenas o primeiro atlas é usado para o personagem.** Se o projecto tiver múltiplos atlas, os restantes são ignorados. O runtime não tem lógica para associar atlas específicos a entidades específicas.
- **Sem colisão no runtime.** O movimento usa `step()` do iso-core (que é só cinemática), mas não integra `canEnter`/`canCross`. O runtime actual move o personagem livremente sem verificação de walkability.
- **Sem suporte a objectos do mapa** (`mapa.objects`). Apenas blocos e arestas são desenhados. Props e personagens adicionais não são renderizados.
- **A câmara não tem limites.** O stage pode deslocar-se indefinidamente.
- **A detecção de spritesheet no `updateCharacterAnim`** usa um cast `(char.sprite as unknown as { spritesheet?: Spritesheet }).spritesheet` porque a API pública do PixiJS 8 `AnimatedSprite` não expõe directamente o spritesheet. Isto funciona mas é frágil.

---

## F4-03 — Verificador da fronteira do runtime

### Arquivos

- `scripts/check-runtime-boundary.sh` — Verificador de fronteira
- `scripts/gate.sh` — Adicionada etapa `check-runtime-boundary` (F4-03)

### API pública

```bash
# Verificação normal
bash scripts/check-runtime-boundary.sh

# Autoteste
bash scripts/check-runtime-boundary.sh --self-test
```

### Decisões de design

1. **Asserção negativa sem `wc -l`.** O script usa `grep` com teste de string vazia (`-z`/`-n`), não `| wc -l` comparado a zero. A contagem de imports existe apenas para logging, não para a asserção.

2. **Autoteste com ficheiro temporário.** `--self-test` fabrica um ficheiro TypeScript com imports proibidos, executa a verificação sobre ele, e exige que o resultado seja FAIL. Se for PASS (falso negativo), o self-test falha.

3. **Controlo positivo.** Verifica que cada directório contém pelo menos um `import`. Se um directório estiver vazio ou só tiver `export`, a verificação falha — um falso positivo silencioso é pior que um falso negativo ruidoso.

4. **Padrão de banned tools.** `character-builder|map-builder|pixellab-pipeline`. A regex casa tanto imports relativos (`../character-builder/`) como imports de caminho absoluto.

5. **Integração no gate.sh.** A etapa corre como `stage` normal (PASS/FAIL), não como `nao_exercitado_stage`.

### Limitações conhecidas

- O grep é textual, não sintático. Um comentário contendo o nome de uma tool proibida dispararia um falso positivo. Na prática, imports estão sempre em linhas de código, não em comentários.
- O controlo positivo exige pelo menos um `import` no directório. Se todos os ficheiros de um directório usarem `import()` dinâmico ou não tiverem imports, o controlo falha — mas isso nunca acontece num directório de código TypeScript real.

---

## Resumo de verificação

```bash
# TypeScript compila limpo
cd tools/runtime && npx tsc -p tsconfig.json --noEmit
# 0 erros

# Boundary checker passa
bash scripts/check-runtime-boundary.sh
# VEREDITO: PASS

# Self-test detecta violações
bash scripts/check-runtime-boundary.sh --self-test
# self-test PASSOU — import proibido foi detetado.

# Gate.sh inclui a nova etapa
bash scripts/gate.sh
# runtime > check-runtime-boundary: PASS
```

## Destinatários nomeados

- **E5 (map-builder integração):** O runtime é o consumidor do artefato exportado. Quando o map-builder exportar um projecto, o comando `npm run play -- <project.json>` deve conseguir carregá-lo e mostrar o mapa.
- **F5 (colisão no runtime):** O runtime actual move o personagem sem verificação de walkability. Integrar `canEnter`/`canCross` e `runTrace` seria o próximo passo natural.
- **F6 (tiles com texturas):** O desenho actual usa losangos coloridos. Carregar um atlas de tiles e aplicar texturas requer estender `drawMap`.
- **Qualquer tool nova:** O script `check-runtime-boundary.sh` terá de ser actualizado se surgir uma quarta tool que também esteja proibida na fronteira do runtime.
