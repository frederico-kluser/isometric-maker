# Índice da documentação

> **Quick Start (TL;DR)**
>
> Quer entender o produto? [`00-produto/visao.md`](00-produto/visao.md). Quer gerar arte? [`01-pixellab/README.md`](01-pixellab/README.md). Quer saber por que algo é do jeito que é? [`adr/`](adr/).
>
> ```bash
> cd /home/ondokai/Projects/isometric-maker/tools/pixellab-pipeline && node src/cli.ts plan
> ```

Estado em **2026-08-05**: **59 arquivos em `docs/` — 43 ADRs e 16 documentos, contando este índice**. Esta tabela não lista documento que não foi escrito.

As pastas são numeradas na ordem em que o produto é construído: o que ele é, de onde vem a arte, o personagem, o mapa, as mecânicas, o runtime.

## 00 — Produto

| Arquivo | Descrição |
| --- | --- |
| [`visao.md`](00-produto/visao.md) | O que o editor é, **o que ele não é**, as quatro partes e os requisitos de ambiente |
| [`glossario.md`](00-produto/glossario.md) | O mesmo conceito em português e em inglês, e as armadilhas de vocabulário |

## 01 — PixelLab

A API que gera a arte. Ela **muda sem versionar**, então a prosa aqui é mínima por decisão: o que envelhece mal fica no spec vendorizado e nas skills, que têm verificação automática contra ele.

| Arquivo | Descrição |
| --- | --- |
| [`README.md`](01-pixellab/README.md) | Os cinco fatos, as seis superfícies do produto, os três erros que os blogs cometem |
| [`custos-e-limites.md`](01-pixellab/custos-e-limites.md) | Preço estimado e limite de tamanho por endpoint, e o orçamento de um projeto |
| [`modelo-assincrono.md`](01-pixellab/modelo-assincrono.md) | `202` mais job id, poll, os códigos estranhos (423, 410, 529), concorrência |
| [`licenca-e-termos.md`](01-pixellab/licenca-e-termos.md) | Posse do asset, uso comercial, Open RAIL-M, ausência de indenização de IP |
| [`delta-vs-guia-antigo.md`](01-pixellab/delta-vs-guia-antigo.md) | Errata de 15 itens contra o guia antigo em `tech-docs/games/5.md` |

## 02 — Personagem

| Arquivo | Descrição |
|---|---|
| [`guarda-roupa-e-silhueta.md`](02-personagem/guarda-roupa-e-silhueta.md) | Por que a API não faz paper-doll, as três soluções que jogos reais usam, e por que silhueta é restrição de autoria |
| [`manequim-e-enquadramento.md`](02-personagem/manequim-e-enquadramento.md) | Por que `template_id: mannequin` não gera manequim, como o modo manequim força o corpo-base, e como o quadro passa a ser preenchido |

## 03 — Mapa

| Arquivo | Descrição |
|---|---|
| [`cubo-e-molde.md`](03-mapa/cubo-e-molde.md) | A conta do cubo isométrico, os três erros clássicos de perspectiva e o molde encadeado nas duas técnicas de bloco |
| [`colisao-solida.md`](03-mapa/colisao-solida.md) | Colisão sólida: caixa AABB de 0,65 célula, varredura por eixo com sliding, push-out MTV e a flag `solid` honrada |

## Plano de execução

| Arquivo | Descrição |
| --- | --- |
| [`plano/README.md`](plano/README.md) | Estado do plano de execução |
| [`plano/experimentos/E1.md`](plano/experimentos/E1.md) | Experimento 1 |
| [`plano/experimentos/E2.md`](plano/experimentos/E2.md) | Experimento 2 |
| [`plano/experimentos/E5.md`](plano/experimentos/E5.md) | Experimento 5 |

## Pastas reservadas

Numeração reservada. A convenção 12 diz que doc de infra escrita antes de existir infra é ficção — a documentação nasce junto com o código ou depois, nunca antes.

| Pasta | O que mora ali | Código correspondente |
| --- | --- | --- |
| `03-mapa/` | Projeção e coordenadas, o formato do mapa XYZ, autoladrilhamento | `packages/iso-core` + editor de mapa em `tools/character-builder/src/map/` — **código existe, doc parcial: [`cubo-e-molde.md`](03-mapa/cubo-e-molde.md) e [`colisao-solida.md`](03-mapa/colisao-solida.md) escritos** |
| `04-mecanicas/` | Movimento, colisão, degrau e salto por altura | `packages/iso-core` — **código existe, doc pendente** |
| `05-runtime/` | Como o projeto exportado é carregado e executado | `tools/runtime` — **código existe, doc pendente** |
| `06-editor/` | Arquitetura do editor, o formato do arquivo de projeto, strings e i18n | — |

## Ferramentas

| Ferramenta | O que faz | Estado |
| --- | --- | --- |
| [`tools/pixellab-pipeline`](../tools/pixellab-pipeline/) | Geração em lote, idempotente, com guard de custo e empacotador de atlas | **funcional** |
| [`tools/character-builder`](../tools/character-builder/README.md) | **O aplicativo inteiro**: tela inicial, estúdio de personagem (Sprite Studio) e editor de mapa — o `tools/map-builder` foi fundido nele | **funcional** |
| [`tools/runtime`](../tools/runtime/) | Carrega o projeto exportado e roda, sem interface de edição (795 linhas em `src/`, coberto pelo gate) | **funcional** |
| [`tools/pixi-reference`](../tools/pixi-reference/README.md) | **Não é o cliente.** Fixa o PixiJS 8.19.0 e vendoriza tipos e as 26 skills oficiais, para as skills citarem em vez de lembrar | **funcional** |

## ADR — decisões registradas

Nunca editadas. Uma decisão revista gera ADR novo que substitui a anterior, e a antiga fica exatamente como foi escrita. A ADR nova declara `**Substitui:** ADR NNNN` numa linha logo abaixo do Status; a coluna `Situação` abaixo é o único lugar onde a supersessão aparece para quem lê o índice.

Há um segundo caso, mais raro: a decisão está certa e um **fato declarado ao lado dela** está errado. Substituir marcaria como obsoleta uma decisão em vigor, o que seria falso. A ADR nova declara então `**Corrige:** ADR NNNN`, e a corrigida continua `vigente` no índice, com a correção anotada. O mecanismo é o mesmo dos dois lados: o arquivo novo ganha um campo, o antigo nunca é tocado.

| ADR | Decisão | Situação |
| --- | --- | --- |
| [`0001`](./adr/0001-pixijs-em-vez-de-cocos.md) | PixiJS 8 + Vite no cliente, divergindo da pesquisa própria que apontava Cocos Creator | substituída por 0014 |
| [`0002`](./adr/0002-cliente-rest-gerado-do-openapi.md) | Cliente REST do OpenAPI vendorizado, não o SDK oficial | vigente |
| `0003` | Permadeath total | apagada — escopo removido pela 0010 |
| `0004` | Combate travado no alvo com zonas oscilantes | apagada — escopo removido pela 0010 |
| [`0005`](./adr/0005-low-top-down-8-direcoes.md) | `view: "low top-down"`, 8 direções, ordem canônica S,SW,W,NW,N,NE,E,SE | substituída por 0015 |
| [`0006`](./adr/0006-animacao-em-template-mode.md) | Animação em `mode='template'`; `pro` proibido sem decisão explícita | vigente |
| `0007` | Fase 1 em VM única, com gatilho numérico para GKE | apagada — escopo removido pela 0010 |
| [`0008`](./adr/0008-idioma-docs-ptbr-codigo-en.md) | Docs em pt-BR; código e commits em inglês | vigente |
| [`0009`](./adr/0009-conhecimento-pixijs-vendorizado.md) | Tipos e skills oficiais do PixiJS 8.19.0 vendorizados; skills citam, não reescrevem a API | vigente |
| [`0010`](./adr/0010-pivo-para-editor-isometrico.md) | **O produto é um editor isométrico, não um MMORPG** | vigente |
| [`0011`](./adr/0011-repo-isometric-maker-pasta-power-abuse.md) | Repositório `isometric-maker`, pasta local continua `power-abuse` | substituída por 0017 |
| [`0012`](./adr/0012-guard-de-orcamento-informativo.md) | O guard de orçamento informa e nunca recusa | vigente |
| [`0013`](./adr/0013-geometria-isometrica-64x32-z16.md) | Tile 64×32, nível Z de 16 px, Z inteiro e discreto | vigente · consequência corrigida pela 0020 |
| [`0014`](./adr/0014-pixijs-para-o-editor.md) | PixiJS 8 continua, agora contra o argumento oposto | vigente |
| [`0015`](./adr/0015-low-top-down-8-direcoes-isometrico.md) | `low top-down`, 8 direções, e o endpoint que o isométrico obriga | substituída por 0019 |
| [`0016`](./adr/0016-ui-ptbr-strings-centralizadas.md) | UI em pt-BR com strings centralizadas desde o primeiro commit | vigente |
| [`0017`](./adr/0017-nome-unico-isometric-maker.md) | Um nome só: `isometric-maker` no repositório, na pasta e nos pacotes | vigente |
| [`0018`](./adr/0018-artefato-de-exportacao.md) | O artefato de exportação: `project.json` v1 | vigente |
| [`0019`](./adr/0019-create-character-v3-e-o-caminho-do-personagem.md) | `create-character-v3` é o caminho do personagem, e o que isso custa | vigente |
| [`0020`](./adr/0020-identidade-da-diagonal-de-picking.md) | A diagonal do picking avança `zStep/tileHeight` por nível, não uma célula | vigente |
| [`0021`](./adr/0021-rotacao-de-camera-em-quatro-vistas.md) | Rotação de câmera em quatro vistas, como parâmetro de vista | vigente · consequência corrigida pela 0029 |
| [`0022`](./adr/0022-blocos-do-mundo-isometricos.md) | Blocos do mundo vêm do `/create-isometric-tile`, e o default é uma geração por bloco | substituída por 0029 |
| [`0023`](./adr/0023-caminho-de-volta-ao-artefato-pago.md) | Toda geração paga registra o caminho de volta ao artefato, e andamento nunca é 404 | vigente |
| [`0024`](./adr/0024-cubo-isometrico-canonico.md) | O cubo isométrico canônico: tile 48×24, aresta vertical 29 | vigente · corrige 0013 |
| [`0025`](./adr/0025-molde-como-referencia-de-geracao.md) | O molde do cubo acompanha toda geração de bloco | substituída por 0029 |
| [`0026`](./adr/0026-giro-de-camera-animado.md) | O giro da câmera é animado: posição interpolada, sprite nunca rotacionado | substituída por 0030 |
| [`0027`](./adr/0027-exportacao-v2-instancias-e-materiais.md) | Exportação v2: cada bloco colocado sai com id, posição, tipo e material | vigente |
| [`0028`](./adr/0028-modo-manequim-e-preenchimento-do-quadro.md) | O manequim é prompt, não `template_id`; e o quadro cheio é pós-processamento | vigente |
| [`0029`](./adr/0029-quatro-vistas-molde-encadeado-e-rotate.md) | Todo bloco tem quatro vistas: molde encadeado, e rotate via v3 para comparar | substituída por 0032 · corrigida pela 0031 |
| [`0030`](./adr/0030-giro-rigido-do-quadro-composto.md) | O giro é do quadro composto: dois snapshots sob a mesma afim, nunca peça por peça | vigente |
| [`0031`](./adr/0031-canvas-multiplo-de-4-e-init-image-quebrado.md) | O canvas da API é múltiplo de 4, e o init_image do tile está quebrado no fornecedor | vigente · corrige 0029 |
| [`0032`](./adr/0032-textura-animada-unica-abandono-3d.md) | Textura animada única: abandono das 4 vistas 3D em favor de animação por `animate-with-text-v3` | vigente · substitui 0029 · consequência corrigida pela 0046 |
| [`0033`](./adr/0033-pacote-de-projeto-autocontido.md) | Pacote de projeto autocontido: mapa, personagem e blocos num JSON só, PNGs em base64 | vigente |
| [`0034`](./adr/0034-aplicativo-unificado-com-tela-inicial.md) | Um aplicativo só: map-builder fundido no character-builder, tela inicial e rotas por hash, tela inativa desmontada | vigente |
| [`0035`](./adr/0035-molde-de-proporcao-como-referencia-de-geracao.md) | Molde de proporção como `init_image` (força 320), referência do usuário como `style_image` (força 50) | vigente |
| [`0036`](./adr/0036-fisica-de-marchas-agachar-e-gravidade.md) | Física jogável: corrida é o default, Shift anda, agachar não pula, gravidade contra o mapa com passo fixo | vigente |
| [`0037`](./adr/0037-editor-3d-apenas.md) | O editor de mapa é 3D (Three.js): o editor 2D do PixiJS sai — 24 arquivos e ~6,3 mil linhas — e `#/mundo` vira a rota única | vigente |
| [`0038`](./adr/0038-colisao-solida-aabb.md) | Colisão sólida: caixa AABB de 0,65 célula varrida por eixo com sliding e push-out MTV; a flag `solid` do catálogo é honrada (água/lava não bloqueiam) | vigente |
| [`0039`](./adr/0039-sprite-unica-sobre-tres-faces.md) | Uma sprite só, esticada sobre as três faces do cubo por UV exato canto-a-canto; o mesh gira com a câmera; faces sem iluminação; a vista canônica é medida por silhueta, e os 6 blocos pagos escondidos voltam à paleta | vigente |
| [`0040`](./adr/0040-zoom-continuo-e-desenho-sob-demanda.md) | Zoom contínuo, amortecido e ancorado no cursor; um laço de quadro só que coalesce e para sozinho; desenho separa mundo de câmera; `shadowMap.autoUpdate = false` | vigente |
| [`0041`](./adr/0041-fila-fifo-persistente-de-geracao.md) | A fila de geração é FIFO por `seq` persistido, o job carrega um descritor serializável e o estado vai a disco; o `Map` volátil e o `spawn` saem, e `'na-fila'` finalmente ganha quem o escreva | vigente |
| [`0042`](./adr/0042-teto-de-concorrencia-mede-chamadas.md) | O peso de admissão da fila é o **pico de chamadas simultâneas** do job, não o custo de servidor da `COST_TABLE`; teto default 8, com `CHARACTER_BUILDER_JOB_CONCURRENCY` > `PIXELLAB_TIER` > default — e o 8 é inferência declarada, não medição | vigente |
| [`0043`](./adr/0043-retomada-sem-repagar-e-o-estado-interrompido.md) | Retomada sem repagar por stub em disco ao lado do artefato; seis dos sete ramos retomam de graça, `wizard-south` para em `'interrompido'`; a janela entre submissão e registro fica declarada | vigente |
| [`0044`](./adr/0044-bloqueio-do-wizard-por-escopo.md) | O bloqueio do wizard tem escopo: `busy` global sai, o dono do job sai do **prefixo** da chave, e `'na-fila'` conta como ocupado | vigente |
| [`0045`](./adr/0045-animacao-do-bloco-no-mapa.md) | A sprite animada do bloco passa a ser desenhada no mapa: uma folha, uma textura, `repeat.x`/`offset.x`; o laço continua parando sozinho; o shadow map não é invalidado; folhas legadas re-empacotadas sem chamar a API | vigente |
| [`0046`](./adr/0046-prompt-do-bloco-respeita-a-descricao.md) | O prompt do bloco passa a respeitar a descrição do usuário (sete defeitos), e a divergência de endpoint com a 0032 fica registrada como dívida de valor conhecido | vigente · corrige 0032 |

## Skills

**39 skills** em [`.agents/skills/`](../.agents/skills/), indexadas em [`catalog.md`](../.agents/skills/catalog.md). O caminho `.claude/skills` é symlink para lá, então qualquer agente vê os mesmos arquivos.

Dois roteadores: [`project-router`](../.agents/skills/project-router/SKILL.md), por onde toda tarefa passa, e [`routing-pixijs-work`](../.agents/skills/routing-pixijs-work/SKILL.md), para qualquer coisa que toque o renderizador. Dez skills cobrem os 79 endpoints do PixelLab, dez cobrem o PixiJS, **quatro cobrem o modelo isométrico** — geometria, física, edição de mapa e rotação de câmera —, sete cobrem o editor 3D de mapa em Three.js, e o restante é tarefa e meta.

As quatro do modelo são novas. Três existem porque o modelo isométrico — `packages/iso-core` mais o editor de mapa, hoje dentro do character-builder — tinha 363 testes passando e nenhuma skill apontando para eles: [`projecting-isometric-geometry`](../.agents/skills/projecting-isometric-geometry/SKILL.md), [`simulating-isometric-physics`](../.agents/skills/simulating-isometric-physics/SKILL.md) e [`editing-isometric-maps`](../.agents/skills/editing-isometric-maps/SKILL.md). A separação entre elas e as do PixiJS é entre **o que é verdade sobre o mundo** e **como o mundo chega à tela**.

A quarta, [`rotating-isometric-camera`](../.agents/skills/rotating-isometric-camera/SKILL.md), reuniu o material para uma decisão que ainda não tinha sido tomada: girar a câmera em quatro vistas. A decisão foi tomada em 2026-08-01 na [ADR 0021](./adr/0021-rotacao-de-camera-em-quatro-vistas.md), com os números lidos do OpenRCT2 e do Godot — inclusive o que desanima, que é o motor de referência manter duas implementações de ordenação e ainda chamar a correção de oclusão de parcial. A skill continua sendo onde esse material mora.

`enforcing-server-authority` foi **retirada com o pivô e não tem sucessora** — o assunto dela deixou de existir.

## Histórico

| Data | O que mudou |
| --- | --- |
| 2026-07-29 | Documentação inicial: manual do PixelLab, design de combate, as oito primeiras ADRs |
| 2026-07-30 | Sprite Studio; conhecimento do PixelLab e do PixiJS vendorizado em vinte skills; ADR 0009 |
| 2026-07-30 | **Pivô para o isometric-maker** ([ADR 0010](./adr/0010-pivo-para-editor-isometrico.md)): docs e ADRs de MMORPG apagados, sete ADRs novas, índice reescrito sem entrada inexistente |
| 2026-08-01 | Rotação de câmera em quatro vistas ([ADR 0021](./adr/0021-rotacao-de-camera-em-quatro-vistas.md)), blocos do mundo pelo `/create-isometric-tile` ([ADR 0022](./adr/0022-blocos-do-mundo-isometricos.md)) e a regra do caminho de volta ao artefato pago ([ADR 0023](./adr/0023-caminho-de-volta-ao-artefato-pago.md)), que corrigiu 14 submissões pagas sem um único PNG em disco |
| 2026-08-01 | **O cubo vira cubo** ([ADR 0024](./adr/0024-cubo-isometrico-canonico.md)): a aresta vertical era 40,8 % do valor geométrico, e o erro aparecia como "a arte não encaixa no mapa". Com ela vieram o molde mandado em toda geração ([ADR 0025](./adr/0025-molde-como-referencia-de-geracao.md)), o giro animado da câmera ([ADR 0026](./adr/0026-giro-de-camera-animado.md)) e a exportação com instâncias e materiais ([ADR 0027](./adr/0027-exportacao-v2-instancias-e-materiais.md)) |
| 2026-08-01 | Modo manequim e preenchimento do quadro ([ADR 0028](./adr/0028-modo-manequim-e-preenchimento-do-quadro.md)): `template_id` era esqueleto e não aparência, `negative_description` e `coverage_percentage` nunca tinham sido enviados, e a moldura estufada da v3 passou a ser recortada com uma bbox só para as 8 direções |
| 2026-08-01 | Spec revendorizado; [ADR 0019](./adr/0019-create-character-v3-e-o-caminho-do-personagem.md) alinha a decisão de personagem ao código em v3; [ADR 0020](./adr/0020-identidade-da-diagonal-de-picking.md) corrige a diagonal do picking e estreia o campo `**Corrige:**`; quatro skills novas para o modelo isométrico, incluindo a de rotação de câmera |
| 2026-08-01 | **Todo bloco passa a ter quatro vistas** ([ADR 0029](./adr/0029-quatro-vistas-molde-encadeado-e-rotate.md)): o modo uniforme e a canonização saem, o molde vira encadeado (o resultado da norte é o `init_image` das outras faces) e nasce a técnica `rotated` via `create-character-v3` para comparar; os cinco blocos uniformes pagos foram arquivados |
| 2026-08-01 | **O mapa gira como um corpo só** ([ADR 0030](./adr/0030-giro-rigido-do-quadro-composto.md)): a transição vira dois snapshots sob a mesma afim (squash–rotate–unsquash), com o precedente do Mode 7 e o insight do Doom; e a primeira compra real das quatro vistas revela duas restrições fora do spec ([ADR 0031](./adr/0031-canvas-multiplo-de-4-e-init-image-quebrado.md)) — canvas múltiplo de 4, e o `init_image` do tile quebrado no fornecedor, com fallback sem referência de imagem |
| 2026-08-02 | **Abandono do 3D: textura animada única** ([ADR 0032](./adr/0032-textura-animada-unica-abandono-3d.md)): as técnicas `chained` e `rotated` (4 vistas) saem em favor de UMA textura animada por bloco — `create-image-pixflux` gera a imagem base, um LLM escreve a ação da animação, e o `/animate-with-text-v3` produz os frames; número de frames configurável (4/8/16); a câmera continua girando (ADR 0030) mas a arte do bloco não muda com a perspectiva |
| 2026-08-02 | **O projeto inteiro num arquivo só** ([ADR 0033](./adr/0033-pacote-de-projeto-autocontido.md)): mapa + personagem + blocos num JSON autocontido, com PNGs em base64 — exporta (POST /api/project/export) e restaura (POST /api/project/import) personagem e blocos; bloco ausente degrada para o cubo procedural |
| 2026-08-02 | **Um aplicativo só** ([ADR 0034](./adr/0034-aplicativo-unificado-com-tela-inicial.md)): o map-builder é fundido no character-builder — tela inicial (`#/`), estúdio (`#/personagem`) e editor de mapa (`#/mundo`) num processo só, `npm run dev` na raiz; molde de proporção adulto/criança como referência de geração ([ADR 0035](./adr/0035-molde-de-proporcao-como-referencia-de-geracao.md)); física jogável no iso-core — marchas, agachar, gravidade e degrau na travessia ([ADR 0036](./adr/0036-fisica-de-marchas-agachar-e-gravidade.md)) |
| 2026-08-03 | **O editor vira 3D** ([ADR 0037](./adr/0037-editor-3d-apenas.md)): o editor 2D do PixiJS sai (24 arquivos, ~6,3 mil linhas), `#/mundo` é a rota única e `mundo3d` vira apelido; e a **colisão ganha corpo** ([ADR 0038](./adr/0038-colisao-solida-aabb.md)): caixa AABB de 0,65 célula varrida por eixo com sliding e push-out MTV, com a flag `solid` do catálogo honrada; doc nova [`colisao-solida.md`](03-mapa/colisao-solida.md) |
| 2026-08-04 | **A sprite do bloco passa a cobrir o cubo** ([ADR 0039](./adr/0039-sprite-unica-sobre-tres-faces.md)): uma sprite só, esticada sobre as três faces por UV exato canto-a-canto, com o mesh girando junto com a câmera e a vista canônica escolhida por casamento de silhueta — seis blocos pagos que o catálogo escondia voltam à paleta; e o **zoom deixa de travar** ([ADR 0040](./adr/0040-zoom-continuo-e-desenho-sob-demanda.md)): zoom contínuo ancorado no cursor, um laço de quadro só que coalesce e para sozinho, e `shadowMap.autoUpdate = false` |

| 2026-08-05 | **A geração ganha uma fila** ([ADR 0041](./adr/0041-fila-fifo-persistente-de-geracao.md)): o `Map` volátil e o `spawn` saem, o estado vai a disco por `seq` monótono e o job carrega um descritor serializável; o teto passa a medir **chamadas simultâneas** e não custo de servidor ([ADR 0042](./adr/0042-teto-de-concorrencia-mede-chamadas.md)), com o 8 declarado como inferência; a retomada deixa de repagar por stub em disco e nasce o estado `'interrompido'` ([ADR 0043](./adr/0043-retomada-sem-repagar-e-o-estado-interrompido.md)), que também expõe um bug de dinheiro pré-existente na leitura dos ids de `animate-character`; o bloqueio do wizard ganha escopo ([ADR 0044](./adr/0044-bloqueio-do-wizard-por-escopo.md)); a sprite animada do bloco passa a ser desenhada no mapa ([ADR 0045](./adr/0045-animacao-do-bloco-no-mapa.md)); e o prompt do bloco passa a respeitar a descrição, com a divergência de endpoint da 0032 registrada ([ADR 0046](./adr/0046-prompt-do-bloco-respeita-a-descricao.md)) |

## Referências

- [`/home/ondokai/Projects/isometric-maker/README.md`](../README.md) — visão geral do repositório
- [`/home/ondokai/Projects/isometric-maker/AGENTS.md`](../AGENTS.md) — instruções para agentes, e as 12 convenções de documentação
- [`/home/ondokai/Projects/isometric-maker/scripts/check-docs.sh`](../scripts/check-docs.sh) — o que é verificado automaticamente nesta pasta
- [`/home/ondokai/Projects/isometric-maker/.agents/skills/catalog.md`](../.agents/skills/catalog.md) — o índice das skills

**Última atualização:** 2026-08-05
