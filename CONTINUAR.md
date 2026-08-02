# Estado do editor — o que foi feito em 2026-08-02 e o que falta

> **Quick Start (TL;DR)**
>
> O editor virou **um aplicativo só**, com tela inicial e rotas. A física de personagem jogável está pronta e testada. Falta ligar o modo de teste na tela do mapa, e falta exportar/importar projeto.
>
> ```bash
> cd /home/ondokai/Projects/isometric-maker
> npm run dev                  # sobe UM servidor; abre a tela inicial
> bash scripts/gate.sh         # portão: 13 PASS, 1 FAIL pré-existente (skills)
> ```

**Última sessão:** 2026-08-02 · **Commits:** `e83e9fa` … `244cfa1` (7 no `main`)

## O que mudou

### 1. Aplicativo único com tela inicial (`e83e9fa`)

`tools/map-builder` **deixou de existir**. O código dele foi para
`/home/ondokai/Projects/isometric-maker/tools/character-builder/src/map/`, e o
`character-builder` passou a ser o editor inteiro — ele já era o único com
servidor (`server/api.ts` montado como middleware do Vite), com `assets/`, com
`studio.json` e com `.env`.

| Rota | Tela | Arquivo |
| --- | --- | --- |
| `#/` | inicial | `tools/character-builder/src/app/home/home-screen.tsx` |
| `#/personagem` | estúdio (wizard / poses / itens / laboratório) | `tools/character-builder/src/app/shell.tsx` |
| `#/mundo` | editor de mapa | `tools/character-builder/src/map/editor/map-editor.tsx` |

O roteador é por hash, escrito à mão em
`tools/character-builder/src/app/router.ts` (~60 linhas, `useSyncExternalStore` +
`hashchange`). **Nenhuma dependência nova** — o repositório congela dependências
de propósito.

`scripts/dev-all.sh` foi apagado; `npm run dev` na raiz sobe um processo só.
A tela inativa é **desmontada**, não escondida: com as duas montadas, o editor de
mapa continuaria sondando `/api/world-blocks` a cada 3 s enquanto o usuário
desenha no estúdio.

**Para adicionar uma rota:** um item em `ROUTES` e um em `ROUTE_HASH` no
`router.ts`; um ramo no ternário do `App.tsx`; uma seção em
`src/strings/inicio.ts` e um `<HomeEntry>` no `home-screen.tsx`.

### 2. Física de personagem jogável (`7650c19`, `43abafd`)

`packages/iso-core` — 473 testes, todos passando.

```ts
// packages/iso-core/src/simulate.ts — o que a tela do mapa deve chamar
stepWithMap(state, input, dt, config, map): MovementState

// packages/iso-core/src/movement.ts — campos NOVOS
type Gait = 'run' | 'walk' | 'crouch'
MovementInput.walk?    // Shift; ausente = CORRE
MovementInput.crouch?  // Control; agachado NÃO pula
MovementConfig.walkFactor?   // 0.5
MovementConfig.crouchFactor? // 0.35
MovementConfig.fallSpeed?    // 12 níveis/s
MovementState.gait | .crouching | .falling | .jump | .blocked
MAX_JUMP_RISE = 1
```

Velocidades com `DEFAULT_CONFIG`: correr 4 u/s, andar 2, agachado 1,4.

- **Gravidade** (`packages/iso-core/src/gravity.ts`): antes, quem pulava ficava
  preso em `z+1` para sempre. Agora cai até o topo sólido da coluna.
- **Pulo sobe 1 bloco, nunca 2** — aritmético em `jumpRise()`, não prometido em
  comentário.
- **Sair da beirada vira queda**: entrar em célula sem apoio passou a ser
  permitido quando há chão alcançável abaixo. `canEnter` **não** mudou.
- `runTrace` virou invólucro de `fixedStepWithMap`: há **uma** resolução de
  colisão na árvore, não duas.

### 3. Deletar bloco gerado (`cc60d69`)

`DELETE /api/world-block/{hash}` — idempotente, valida `/^[a-f0-9]{16}$/i`.

| Código | Quando |
| --- | --- |
| 200 | apagado (ou já não existia) |
| 400 | hash malformado — nada foi apagado |
| 409 | há geração em curso para o hash |

O 409 é sobre dinheiro: o diretório guarda os stubs `*.pending.json`, que são o
caminho de volta **gratuito** ao que a PixelLab já cobrou, e não há cancelamento.

Botão de pressionar-e-segurar (1,5 s) em cada card do catálogo, em
`src/app/screens/laboratorio/blocks-panel.tsx`. A tela avisa a consequência: um
mapa que já tinha o bloco passa a mostrar cubo procedural.

### 4. Molde de proporção adulto/criança (`80279ff`)

Os dois PNGs que estavam na raiz foram para
`/home/ondokai/Projects/isometric-maker/packages/game-assets/moldes/{adulto,crianca}.png`,
**convertidos para RGBA** — os originais eram colorType 3 (paleta) e o
decodificador deste repositório só lê 0, 2, 4 e 6.

Medido nos arquivos, quadro de 256×256:

| Molde | caixa opaca | altura | linha de chão |
| --- | --- | --- | --- |
| adulto | x 85–232, y 18–251 | 233 px | y = 251 |
| criança | x 93–226, y 103–251 | 148 px | y = 251 |

Mesma linha de chão, alturas diferentes. É a **única** informação que um molde
carrega, e há teste travando isso.

Seletor de três opções no passo da sul (`Nenhum / Adulto / Criança`). Com molde:

| Campo do `/create-image-bitforge` | O que vai | Força |
| --- | --- | --- |
| `init_image` | o molde — posição e tamanho | `MOLD_INIT_STRENGTH = 320` |
| `style_image` | a referência do usuário — aparência | `REFERENCE_STYLE_STRENGTH = 50` |
| `negative_description` | ganha `MOLD_NEGATIVE` | — |

**Por que 320 e não 500:** 400–600 é a faixa de "variação fiel", e fidelidade a
um boneco de madeira traria a madeira junto com a proporção.

**Sem molde, nada muda:** a referência volta a `init_image` com força 500, que é
o comportamento histórico. Há teste para os dois caminhos.

Pesquisa que sustenta isso, feita no spec vendorizado em 2026-08-02: o
`/create-image-bitforge` declara **cinco** campos de imagem independentes
(`init_image`, `style_image`, `color_image`, `inpainting_image`, `mask_image`) e
o wizard usava dois. Nenhum endpoint de personagem aceita array de imagens.

### 5. Fundação do personagem no mapa (`244cfa1`)

Três módulos novos, 26 testes:

- `tools/character-builder/src/map/actor.ts` — direção, entrada e escolha de
  animação. **As duas conversões andam em sentidos opostos** e confundi-las é o
  defeito clássico: a tecla é intenção de tela e vira direção de mundo com
  `unrotatePoint`; o `facing` é ângulo de mundo e vira índice de direção da
  vista girando o vetor com a mesma `rotatePointContinuous` que `cellToScreen`
  usa.
- `tools/character-builder/src/map/collision-map.ts` — `buildCollisionMap(map)`,
  a **primeira ponte real** entre `MapData` e o `CollisionMap` do iso-core (até
  aqui, todo `CollisionMap` da árvore era duplo de teste).
- `tools/character-builder/src/map/scene.ts` — ganhou `ActorDraw`,
  `preloadActor(urls)` e desenho do personagem **dentro** da ordenação dos
  blocos, ancorado nos pés no chão da célula.

O teste que importa já passa: **pular alcança um bloco e não alcança dois.**

## O que falta

### A. Ligar o modo de teste na tela do mapa — **próximo passo**

É o que falta para você jogar. Tudo abaixo já existe; falta só a fiação em
`tools/character-builder/src/map/editor/map-editor.tsx`.

1. **Botão "Testar" / "Editar"** alternando um estado `modo: 'editar' | 'testar'`.
   Texto novo em `tools/character-builder/src/map/strings.ts` (pt-BR, ADR 0016).
2. **Carregar o personagem**: `GET /api/studio` já devolve tudo. Os quadros
   estáticos das 8 direções estão na célula `${characterId}::__directions8__`, em
   `cell.frames` (`Record<direção, string[]>` com URLs `/assets/...`). As poses
   estão em `${characterId}::${poseId}` — os ids embutidos são `parado`,
   `caminhando`, `correndo`, `pulando`, `atacando`. Monte o `ActorFrames` de
   `actor.ts` a partir disso e chame `scene.preloadActor(urls)`.
3. **Posição inicial**: `spawnZAt(colisao, x, y)` de `collision-map.ts` devolve o
   z em que o personagem assenta sem nascer dentro de pedra nem flutuando.
4. **Teclado** (só no modo teste; ignore quando o foco está em `INPUT|TEXTAREA|SELECT`,
   como o handler que já existe faz):

   | Tecla | Efeito |
   | --- | --- |
   | WASD / setas | `worldDirectionFromKeys(held, camera.rotation)` |
   | Space | `input.jump` |
   | Control | `input.crouch` |
   | Shift | `input.walk` (sem Shift, corre) |

   Cuidado: **Shift já é usado para pan** no `onPointerDown` do modo de edição
   (`map-editor.tsx`). No modo teste ele tem que virar "andar".
5. **Laço de quadro**: `app.ticker.add(...)` só no modo teste, chamando
   `stepWithMap(state, input, app.ticker.deltaMS / 1000, CONFIG, colisao)` e
   depois `scene.render({ ...state, actor })`. Hoje a cena redesenha **por
   mudança de estado**, não por quadro (ADR 0010) — o ticker do modo teste é a
   exceção, e tem que ser removido ao sair.
6. **Montar o `ActorDraw`**: `url` vem de `frameUrl(frames, base, actionFor(state),
   directionNameFor(viewDirectionIndex(state.facing, camera.turn)), tick)`;
   `offsetY` vem de `visualOffsetY(state.jump.progress, alturaPx)` de
   `packages/iso-core/src/jump.ts` — **decoração de tela, nunca somada ao `z`**.
7. **Reconstruir o `CollisionMap`** quando o mapa mudar, não a cada quadro.

**Não existe animação de agachar.** A biblioteca de templates da PixelLab não
traz agachar e o estúdio nunca gerou uma; `ACTION_FALLBACK` já cai para `parado`.
Se quiser a animação de verdade, é gerar uma pose com `kind: 'action'` e texto
livre, como `caminhando` e `correndo` já fazem.

### B. Exportar tudo em JSON e importar na tela inicial

Hoje existe meio caminho:

- **Exportar mapa**: `handleExport` no `map-editor.tsx` chama `buildExport` e
  baixa `mapa.json` (`MapExportV2` — instâncias de bloco com material, de
  `packages/iso-core/src/map-instances.ts`).
- **Exportar personagem**: `POST /api/wizard/export` devolve um `WizardBundle`
  (JSON com os PNGs em base64).
- **Importar**: só personagem, via `POST /api/characters/import`.

Falta um **pacote de projeto** que carregue mapa + paleta + blocos gerados +
personagem, e o botão de importar na tela inicial. Decisões a tomar:

- Autocontido (PNGs em base64, arquivo grande) ou referencial (caminhos)? O
  `WizardBundle` já é autocontido; o `ProjectV1` da ADR 0018 é referencial.
  Formato novo **exige ADR nova** — a ADR 0018 não se edita.
- Um `.map` exportado pode citar id de bloco que foi apagado depois. Hoje o
  runtime degrada para cubo procedural. Falhar alto ou degradar? Decida e
  registre.

### C. Documentação

**`README.md` e `AGENTS.md` ainda descrevem dois construtores em duas portas** e
mandam rodar `cd tools/map-builder && npm test` — diretório que não existe mais.
A tabela de comandos do `AGENTS.md` e a linha 63 do `README.md` são as duas mais
erradas.

ADRs que o trabalho de hoje deve: aplicativo unificado com tela inicial;
molde de proporção como referência de geração (a ADR 0025 é sobre molde de
**bloco**, não de personagem); física de marchas, agachar e gravidade; e o
formato do pacote de projeto, quando ele existir. **ADR não se edita** — decisão
revista gera ADR nova com `**Substitui:** ADR NNNN`. Ao adicionar doc, atualizar
a tabela de `docs/README.md` — `scripts/check-docs.sh` cobra o formato.

### D. Portão verde

```
PASS: 13  FAIL: 1  AUXILIAR: 2
```

O único FAIL é `run-skill-evals.mjs`, com 5 skills: `animating-pixellab-sprites`,
`composing-pixellab-objects`, `guarding-generation-cost`,
`meta-skill-consolidate`, `meta-skill-evolution`. **É pré-existente** — falhava
no `main` limpo antes desta sessão, com 6 skills (o trabalho de hoje consertou
`editing-isometric-maps` de passagem). São citações de proveniência defasadas
mais uma invariante perdida em `animating-pixellab-sprites`.

Falta também apagar `TASK_PLAN.md` (é gitignored e descartável, o router pede que
não fique para trás).

## Armadilhas descobertas nesta sessão

1. **`console.log` em arquivo de teste corrompe o `node --test`.** O runner
   transporta o resultado de cada arquivo filho pelo **stdout**, em quadros v8
   serializados com prefixo de tamanho; escrita crua no meio de um quadro aborta
   o arquivo inteiro com `Unable to deserialize cloned data`. Era intermitente e
   mudava de arquivo entre rodadas. Corrigido em `12ae0bb` (27 ocorrências). Se
   precisar imprimir, use `t.diagnostic(...)` ou `console.error` (stderr é fd
   separado).
2. **Gravidade e degrau precisam concordar sobre qual célula é o chão.** A
   primeira versão validava o degrau na célula **vizinha** e subia o `z` na hora;
   a gravidade reavaliava o suporte na célula **atual**, onde aquele `z` é
   insuportado por construção, e desfazia o degrau. Sintoma: 7 de 8 posições de
   degrau deixaram de ser escaláveis, e **se um degrau era escalável dependia da
   fase do acumulador de queda**, não da geometria. Corrigido fazendo o degrau
   acontecer na travessia da aresta (`stepZOnCross`).
3. **`tools/runtime/src/main.ts` chama `step` com 4 argumentos, sem mapa** — o
   personagem do runtime continua sem gravidade e sem colisão. Quem passa o mapa
   é a tela do editor. Não é defeito; é fronteira.
4. **`hasEdge` não recebe `tipo`**, então toda aresta bloqueia igual: uma `porta`
   barra tanto quanto uma `parede`. O editor ainda não tem ferramenta de aresta,
   então `edges` está sempre vazio na prática.
5. **Degrau diagonal não sobe** — `canStepUp` exige adjacência cardinal. É
   herdado, medido igual antes e depois da sessão. Implementar exige decisão.
6. **`assets/` é gitignored.** Ao testar qualquer coisa que apague arquivo, use
   `CHARACTER_BUILDER_ASSETS_DIR` num diretório temporário. Nunca aponte teste ou
   navegador para `tools/character-builder/assets/`.
7. **Worktree sem `node_modules` cai num `tsc` global 4.9.5** que rejeita
   `erasableSyntaxOnly` e cospe ~15 erros falsos. Crie um symlink para o
   `node_modules` do checkout principal.

## Como verificar

```bash
cd /home/ondokai/Projects/isometric-maker
bash scripts/gate.sh                                # 13 PASS, 1 FAIL conhecido
cd packages/iso-core && npm test                    # 473 testes
cd tools/character-builder && npm test              # 459 testes
cd tools/character-builder && npm run typecheck
```

Para ver na tela: `npm run dev` na raiz, `http://localhost:5174/`. Verificado em
Chromium headless nesta sessão: a tela inicial mostra os dois caminhos, `#/mundo`
monta o canvas e carrega a paleta com `200 /api/world-blocks`, e voltar para `#/`
desmonta o canvas.

## Referências

- [`AGENTS.md`](AGENTS.md) — instruções do repositório (**desatualizado**: ver seção C)
- [`README.md`](README.md) — visão geral (**desatualizado**: ver seção C)
- [`docs/adr/0010-pivo-para-editor-isometrico.md`](docs/adr/0010-pivo-para-editor-isometrico.md) — o editor é local e de um usuário só
- [`docs/adr/0016-ui-ptbr-strings-centralizadas.md`](docs/adr/0016-ui-ptbr-strings-centralizadas.md) — texto do usuário em pt-BR, centralizado
- [`docs/adr/0018-artefato-de-exportacao.md`](docs/adr/0018-artefato-de-exportacao.md) — `project.json` v1, referencial
- [`docs/adr/0027-exportacao-v2-instancias-e-materiais.md`](docs/adr/0027-exportacao-v2-instancias-e-materiais.md) — `MapExportV2`
- [`tools/pixellab-pipeline/openapi/openapi-v2.json`](tools/pixellab-pipeline/openapi/openapi-v2.json) — a única fonte sobre a API da PixelLab

**Última atualização:** 2026-08-02
