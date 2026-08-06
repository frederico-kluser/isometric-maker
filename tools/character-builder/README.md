# O aplicativo do editor — tela inicial, estúdio de personagem e editor de mapa (tools/character-builder)

> **Quick Start (TL;DR)**
>
> Este é o **aplicativo inteiro** do editor: tela inicial, estúdio de
> personagem e editor de mapa, num processo só. O estúdio cria o corpo base nas
> 8 direções via create-character-v3 com N saídas em paralelo e exporta JSON; o
> wizard importa esse bundle, deriva as 8 direções e exporta JSON de volta — e
> poses, guarda-roupa e personagens derivados saem daí. O token nunca chega ao
> navegador.
>
> ```bash
> cd /home/ondokai/Projects/isometric-maker
> npm run dev        # raiz: sobe o editor inteiro em http://localhost:5174/
> ```
>
> (equivale a `cd tools/character-builder && npm run dev`; o token fica no
> `.env` — `export PIXELLAB_SECRET="..."` só se quiser sobrescrever.)

## O aplicativo

Três telas, um Vite só, roteamento por hash ([ADR 0034](../../docs/adr/0034-aplicativo-unificado-com-tela-inicial.md)):

| Rota | Tela | Arquivo |
| --- | --- | --- |
| `#/` | inicial — as duas portas (personagem e mundo) | `src/app/home/home-screen.tsx` |
| `#/personagem` | estúdio (wizard / poses / itens / laboratório) | `src/app/shell.tsx` |
| `#/mundo` | editor de mapa | `src/map/editor/map-editor.tsx` |

O `tools/map-builder` foi fundido aqui em 2026-08-02: a geometria, o
autoladrilhamento e a exportação do mapa moram em `src/map/`, e a fundação do
personagem jogável (direção, entrada, colisão) em `src/map/actor.ts` e
`packages/iso-core/src/collision-map.ts`. A tela inativa é **desmontada**, não escondida —
com as duas montadas, o editor de mapa continuaria sondando `api/world-blocks`
a cada 3 s enquanto o usuário desenha no estúdio.

O restante deste README documenta o **estúdio de personagem** — a parte mais
antiga e a mais testada do aplicativo.

## A ideia

## A ideia

Um personagem é **um corpo base** — careca, sem roupa, sem opinião visual — derivado **uma vez** nas 8 direções. Todo o resto sai dele: poses, roupas, armas, personagens derivados.

Isso não é preferência de organização. É o que mantém a arte coerente e a conta pequena: derivar preserva identidade e paleta, gerar do zero não. Na v2, quem constrói esse corpo é o **wizard do manequim** — o fluxo antigo de "anexar referência e chamar o endpoint de criação" morreu.

## O fluxo do wizard (cadeia derivativa)

Cada etapa se apoia na arte da anterior, e cada célula `pronto` é terminal — reexecutar refaz só o que faltou:

```text
1. sul por texto        /create-image-bitforge   descrição → PNG da sul (síncrono)
2. edição da sul        /edit-image              novo prompt → nova versão (undo é grátis, sem API)
3. oito direções        /create-character-v3     reference_image = sprite sul ativo:
                        o modelo v3 rotaciona sozinho para as 8 direções.
                        O passo de cardeais (/rotate) foi removido com a migração.
```

As decisões de API acima foram confirmadas no spec vendorizado (`/home/ondokai/Projects/isometric-maker/tools/pixellab-pipeline/openapi/openapi-v2.json`, capturado 2026-07-29) e estão anotadas no cabeçalho de `/home/ondokai/Projects/isometric-maker/tools/character-builder/server/mannequin.ts`.

A cadeia também pode **começar no meio**, por import de bundle JSON (detalhes em *Bundles JSON*, abaixo): um bundle `sprite-lab-south` aplica a sul escolhida no Laboratório e estaciona o wizard na etapa `direcoes8`; um bundle `sprite-wizard-directions` entrega o personagem direto em `pronto`, com remoteId. Qualquer outro `kind` — uma "config normal" do estúdio, por exemplo — é recusado com erro nomeado.

## A trava de frames (lock)

Antes da primeira geração, o wizard trava `frameCount` (4, 8 ou 16), `fps`, `size` (32–256), `view`, e `templateId` em `studio.json`. Depois do manequim pronto a trava é **imutável**: toda pose, peça e personagem derivado herda, e a UI para de oferecer a escolha. Só o manequim trava; derivados herdam.

Um import de bundle interage com a trava: studio **sem** lock trava na hora com `{frameCount, fps, size}` do bundle (o bundle do laboratório não carrega frames, então cai no default `{frameCount: 8, fps: 8}`); studio **com** lock exige que o `size` do bundle bata, senão o import é recusado — o lock é imutável depois de travado.

## Manequim default: export/import

O manequim é o personagem mais caro do estúdio (sul + 3 rotações + 8 direções). O botão de export grava o resultado em `/home/ondokai/Projects/isometric-maker/packages/game-assets/manequim/` — `mannequin.json` + 12 PNGs (sul, 3 cardeais, 8 direções) — e o import restaura esse bundle num studio novo ou quebrado **sem chamar a API**: é filesystem e validação (dimensões e schema), nunca rede. Com o bundle presente, o wizard oferece o atalho "importar default do projeto".

**Verificado em 2026-07-31:** o diretório ainda não existe — nenhum manequim foi exportado até aqui, então o atalho não aparece numa instalação fresca.

## Personagens derivados

Com o manequim pronto, a aba Wizard cria personagens derivados, que percorrem o **mesmo wizard** com estado próprio. O que os prende ao manequim é a sul ativa dele indo como `color_image` (paleta forçada) na geração da sul e nas 8 direções — mecanismo que existe nos dois endpoints, confirmado no spec. Sem o arquivo da sul no disco, o derivado segue sem referência e só perde a paleta travada (avisado no log do servidor, não é erro).

## Bundles JSON: Laboratório → Wizard → Poses/Itens

Além do manequim default, circulam dois bundles de sprite em JSON (PNGs em base64 + a config que os gerou). O parse e a validação vivem em `/home/ondokai/Projects/isometric-maker/tools/character-builder/server/sprite-bundle.ts`: **toda** a validação (schema, PNGs via `validateImport`, regras de lock e de alvo) roda antes de gravar o primeiro byte, e os erros nomeiam o campo ofensor. Como o manequim default, import é filesystem e validação — **nunca rede**.

- **`sprite-lab-south`** — export do Laboratório (download client-side): a sul escolhida entre os N candidatos + todos os candidatos + a config. O Wizard importa (`POST /api/wizard/import`), aplica a sul e segue para as 8 direções.
- **`sprite-wizard-directions`** — export do Wizard (`POST /api/wizard/export`, exige etapa `pronto`): sul + 8 direções + config + remoteId. Importar no Wizard entrega o personagem pronto; importar em Poses ou Itens (`POST /api/characters/import`) cria um **personagem derivado** já com as células prontas e o remoteId carregado.

Duas garantias de simetria: reimportar o mesmo bundle no mesmo alvo produz as mesmas escritas (o `at` das células vem do `exportedAt` do bundle, não do relógio), e num import de bundle de laboratório o remoteId antigo é **descartado** — a sul mudou, então o id remoto apontaria para arte velha.

## As quatro abas

- **Wizard** — a cadeia derivativa acima, por personagem, com as versões da sul e o atalho de import do default.
- **Poses** — grade poses × 8 direções; passar o mouse numa célula pronta anima o ciclo. `frameCount` visível e travado.
- **Itens** — guarda-roupa: cadastro guiado em sheet, cards com preview animado, peça presa à silhueta. Uma peça só vale entre personagens da **mesma silhueta** — o estúdio recusa a combinação impossível antes de gastar.
- **Laboratório** — o **Sprite Studio**: bancada livre do `/create-character-v3` com todas as configs do endpoint (description, view, size 32–256, seed, no_background, outline, detail, enhance_prompt, template_id, reference_image — a tela redimensiona para o teto de 256×256 no cliente, com smoothing desligado) e N saídas em paralelo (1–4, seeds determinísticas base+i). De cada candidato a bancada extrai só o frame `south` — a v3 sempre produz as 8 direções, e os outros 7 frames ficam em disco como subproduto. Exporta o JSON `sprite-lab-south`. O teto de 4 saídas paralelas é **decisão do projeto**: a v3 documenta o 429 "Concurrency limit reached" mas não publica número em lugar nenhum. O playground do `/rotate` sobrevive como sub-seção da aba: par from/to_direction ou ângulos, idempotente por hash, resultado lado a lado. O único número exibido é o `usage` que a própria API devolveu.

## O detalhe que muda o desenho

**Só existem 10 templates de animação**, verificados no spec vendorizado em 2026-07-29:

```text
angry · attack · attack-back · attack-left · attack-right
backflip · bark · breathing-idle · cross-punch · crouched-walking
```

**`walk`, `run` e `jump` não estão na lista.** Por isso as poses embutidas *Caminhando*, *Correndo* e *Pulando* nascem como `action` (texto livre), não como template — fingir que existe template produziria silenciosamente a animação errada.

## Stack e bootstrap

React 19 + Tailwind 4 + shadcn (`base-nova`) + Motion UI, sem passo de build: o Vite serve `src/` e o middleware de API em `server/` (o Node 24 executa o `.ts` do servidor por type stripping). Vanilla TS morreu na v2.

Duas armadilhas de bootstrap que não são óbvias:

- **O registry `@motion` é fechado por token.** `/home/ondokai/Projects/isometric-maker/tools/character-builder/.npmrc` aponta o escopo `@motionplus` para `https://api.motion.dev/npm/` com `_authToken=${MOTION_TOKEN}` (placeholder), e o `components.json` registra o registry `@motion` com o mesmo token. Sem `MOTION_TOKEN` exportado, `npm install` e `npx shadcn add @motion/…` falham. Rodar `npm run dev` **não** precisa do token — as dependências já estão instaladas.
- **`/home/ondokai/Projects/isometric-maker/tools/character-builder/scripts/patch-vendored-ts.mjs` existe porque os fontes vendorados do Motion UI não passam no `exactOptionalPropertyTypes: true` deste repo.** Eles pertencem ao shadcn CLI (cada `npx shadcn add` os sobrescreve — nunca edite à mão), então o script prefixa `// @ts-nocheck` em cada um: suprime erros *dentro* do arquivo vendorado, e os consumidores continuam com typecheck completo das props. **Rode de novo após cada `shadcn add @motion/…`.**

## Orçamento: sem diálogo na tela

A UI **não pergunta nem estima** — não existe diálogo de orçamento em nenhuma forma, e a rota `/api/estimate` morreu com a v1. O guard continua no servidor ([ADR 0012](../../docs/adr/0012-guard-de-orcamento-informativo.md)): toda geração estima, loga no stdout do servidor e escreve uma linha em `/home/ondokai/Projects/isometric-maker/tools/character-builder/assets/ledger.ndjson`. Informa, nunca recusa.

Idempotência é a outra metade da proteção: célula `pronto` é terminal de ponta a ponta. A rota `/api/generate` responde sem dar spawn numa célula pronta, e os geradores de pose e guarda-roupa releem a célula antes de chamar a API — um clique duplo não cobra de novo. O wizard faz a mesma leitura em cada etapa.

## Arquitetura

```text
vite.config.ts            middleware de API no dev server — o token fica no Node
server/model.ts           studio.json v2: tipos, chaves de célula, estado semente
server/api.ts             rotas /api/*, registro de jobs, escrita dos PNGs
server/mannequin.ts       wizard: sul, edição, cardeais, 8 direções
server/mannequin-io.ts    export/import do manequim default (sem rede)
server/rotate-lab.ts      playground do /rotate (sub-seção do Laboratório)
server/sprite-lab.ts      Sprite Studio: N candidatos v3 em paralelo, extrai a sul
server/sprite-bundle.ts   bundles JSON (lab/wizard): validação total, import/export sem rede
server/freeze-proof.ts    prova de que as cardeais sobreviveram congeladas
src/app/                  tela inicial + shell + as 4 telas (React)
src/app/router.ts         roteador por hash (3 rotas), tela inativa desmontada
src/map/                  editor de mapa, autoladrilhamento, ator e colisão (ex-map-builder)
src/strings/              todo texto visível, pt-BR, acesso por propriedade
studio.json               estado de autoria v2: versionável, diffável, no git
studio.v1.arquivado-2026-07-31.json   estado v1 arquivado (sem migração)
assets/                   PNGs gerados + ledger.ndjson
```

Três decisões, e o porquê de cada uma:

- **O token nunca vai ao navegador.** Um `fetch` para `api.pixellab.ai` no cliente colocaria o segredo no devtools, e esta ferramenta gasta dinheiro real.
- **Polling, não WebSocket.** Job leva 2 a 5 minutos; o servidor é dono do registro, então recarregar a página não perde trabalho **que já foi pago**.
- **`studio.json` em vez de banco.** É dado de autoria, e dado de autoria mora ao lado do asset que descreve — com histórico no git. A v1 foi arquivada, não migrada.

## Limitações conhecidas

- **Sem editor visual de esqueleto.** O tipo `skeleton` e os 18 keypoints continuam no model, mas a v2 não tem tela para eles e o `/api/generate` recusa pose de esqueleto — a geração por `animate-with-skeleton` não está ligada.
- **Sem paper-doll em tempo de execução.** O guarda-roupa gera um personagem completo vestido, não uma camada separada — deliberado: **a API não tem primitiva de equipamento entre personagens**, e o `transfer-outfit-v2` é limitado a 3 frames por job acima de 80px. As três soluções que jogos reais usam estão em [`docs/02-personagem/guarda-roupa-e-silhueta.md`](../../docs/02-personagem/guarda-roupa-e-silhueta.md).
- **Sem aprovar/reprovar na tela.** Regerar sobrescreve. O `rejectedHashes` do pipeline resolve isso do lado do lote, mas ainda não está ligado aqui.
- **A trava do servidor cobre `pronto`, não `gerando`.** Duas submissões da mesma célula enquanto ela ainda gera passam as duas — a UI segura o botão durante o job, mas o servidor não. Clique duplo em célula **pronta** está travado; em voo, não.
- **`npm install` exige `MOTION_TOKEN`** (ver Stack e bootstrap) — um clone fresco sem o token não instala.

## Referências

- `/home/ondokai/Projects/isometric-maker/docs/01-pixellab/` — o manual da API
- `/home/ondokai/Projects/isometric-maker/tools/pixellab-pipeline/openapi/openapi-v2.json` — o spec, fonte de verdade
- `/home/ondokai/Projects/isometric-maker/tools/pixellab-pipeline/src/api.ts` — o transporte reaproveitado (429/529/423, backoff, poll)
- `/home/ondokai/Projects/isometric-maker/docs/adr/0012-guard-de-orcamento-informativo.md` — o guard informa e nunca recusa
- `/home/ondokai/Projects/isometric-maker/docs/02-personagem/guarda-roupa-e-silhueta.md` — silhueta como restrição real

**Última atualização:** 2026-08-02
