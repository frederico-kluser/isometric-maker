# Sprite Studio — estúdio de autoria de personagens (tools/character-builder)

> **Quick Start (TL;DR)**
>
> Estúdio local de sprites: o wizard constrói o manequim em cadeia derivativa (sul por texto → edição → cardeais → 8 direções), e poses, guarda-roupa e personagens derivados saem dele. O token nunca chega ao navegador.
>
> ```bash
> cd /home/ondokai/Projects/isometric-maker/tools/character-builder
> export PIXELLAB_SECRET="..."
> npm run dev        # http://localhost:5174
> ```

## A ideia

Um personagem é **um corpo base** — careca, sem roupa, sem opinião visual — derivado **uma vez** nas 8 direções. Todo o resto sai dele: poses, roupas, armas, personagens derivados.

Isso não é preferência de organização. É o que mantém a arte coerente e a conta pequena: derivar preserva identidade e paleta, gerar do zero não. Na v2, quem constrói esse corpo é o **wizard do manequim** — o fluxo antigo de "anexar referência e chamar o endpoint de criação" morreu.

## O fluxo do wizard (cadeia derivativa)

Cada etapa se apoia na arte da anterior, e cada célula `pronto` é terminal — reexecutar refaz só o que faltou:

```text
1. sul por texto        /create-image-bitforge   descrição → PNG da sul (síncrono)
2. edição da sul        /edit-image              novo prompt → nova versão (undo é grátis, sem API)
3. cardeais             /rotate                  south→east ∥ south→north em paralelo, depois south→west
4. oito direções        /create-character-with-8-directions
                        directions={south,east,north,west}: diagonais geradas,
                        cardeais congeladas, prova de congelamento ao final
```

As decisões de API acima foram confirmadas no spec vendorizado (`/home/ondokai/Projects/isometric-maker/tools/pixellab-pipeline/openapi/openapi-v2.json`, capturado 2026-07-29) e estão anotadas no cabeçalho de `/home/ondokai/Projects/isometric-maker/tools/character-builder/server/mannequin.ts`.

## A trava de frames (lock)

Antes da primeira geração, o wizard trava `frameCount` (4, 8 ou 16), `fps` e `size` (16–128) em `studio.json`. Depois do manequim pronto a trava é **imutável**: toda pose, peça e personagem derivado herda, e a UI para de oferecer a escolha. Só o manequim trava; derivados herdam.

## Manequim default: export/import

O manequim é o personagem mais caro do estúdio (sul + 3 rotações + 8 direções). O botão de export grava o resultado em `/home/ondokai/Projects/isometric-maker/packages/game-assets/manequim/` — `mannequin.json` + 12 PNGs (sul, 3 cardeais, 8 direções) — e o import restaura esse bundle num studio novo ou quebrado **sem chamar a API**: é filesystem e validação (dimensões e schema), nunca rede. Com o bundle presente, o wizard oferece o atalho "importar default do projeto".

**Verificado em 2026-07-31:** o diretório ainda não existe — nenhum manequim foi exportado até aqui, então o atalho não aparece numa instalação fresca.

## Personagens derivados

Com o manequim pronto, a aba Wizard cria personagens derivados, que percorrem o **mesmo wizard** com estado próprio. O que os prende ao manequim é a sul ativa dele indo como `color_image` (paleta forçada) na geração da sul e nas 8 direções — mecanismo que existe nos dois endpoints, confirmado no spec. Sem o arquivo da sul no disco, o derivado segue sem referência e só perde a paleta travada (avisado no log do servidor, não é erro).

## As quatro abas

- **Wizard** — a cadeia derivativa acima, por personagem, com as versões da sul e o atalho de import do default.
- **Poses** — grade poses × 8 direções; passar o mouse numa célula pronta anima o ciclo. `frameCount` visível e travado.
- **Itens** — guarda-roupa: cadastro guiado em sheet, cards com preview animado, peça presa à silhueta. Uma peça só vale entre personagens da **mesma silhueta** — o estúdio recusa a combinação impossível antes de gastar.
- **Laboratório** — playground livre do `/rotate`: par from/to_direction ou ângulos, troca de view, init_image. Uma chamada por execução, idempotente por hash, resultado lado a lado e histórico da sessão. O único número exibido é o `usage` que a própria API devolveu na chamada.

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
server/rotate-lab.ts      laboratório de rotação (playground do /rotate)
server/freeze-proof.ts    prova de que as cardeais sobreviveram congeladas
src/app/                  shell + as 4 telas (React)
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

**Última atualização:** 2026-07-31
