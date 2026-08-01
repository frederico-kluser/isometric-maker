# ADR 0023 — Toda geração paga registra o caminho de volta ao artefato, e andamento nunca é 404

> **Quick Start (TL;DR)**
>
> Em 2026-08-01 o repositório tinha 14 submissões pagas de `create-character-v3` e **zero PNG em disco**, com 197 testes verdes. A causa foi ler os frames do lugar errado; o agravante foi o ledger não guardar o `character_id`, o que tornou o artefato pago irrecuperável a partir do histórico. Três regras saem daí.
>
> ```bash
> cd /home/ondokai/Projects/isometric-maker/tools/character-builder && npm test
> ```

**Status:** aceita · **Data:** 2026-08-01

## Contexto

O Sprite Studio parecia travado: ao gerar, o navegador registrava
`GET /api/sprite-lab/<hash> 404` a cada três segundos, indefinidamente. O diagnóstico encontrou três
defeitos empilhados, e nenhum deles estava no lugar onde o sintoma aparecia.

1. **O `create-character-v3` não devolve pixels no background job.** O `last_response` de um job
   concluído traz `{character_id, directions_count, uploaded_directions, saved_to_storage}` — metadado
   puro. As imagens só existem em `GET /characters/{character_id}`, no campo `rotation_urls`, e o spec
   avisa: "rotation_urls is null unless status == 'completed'". O código passava o `last_response`
   direto para o parser de frames, que não achava imagem e morria **depois** da cobrança.

2. **A tela nunca ficava sabendo.** O hook que lê a rota local `GET /api/studio` só ligava a sondagem quando `busy`
   já era verdadeiro, e `busy` saía do próprio snapshot. Um job nascido depois da montagem jamais
   aparecia: sem sondagem não chega snapshot novo, sem snapshot novo `busy` fica falso, e sem `busy`
   não liga a sondagem. A falha do job existia no servidor e não chegava à tela.

3. **A suíte confirmava a fantasia.** O cliente falso devolvia base64 dentro do background job — uma
   resposta que a API real nunca produziu. 197 testes passavam sobre um contrato inventado.

Investigando, o laboratório de rotação (`/rotate`) mostrou o mesmo padrão por outro motivo:
`from_image` ia como string crua, e o spec exige `Base64Image` — um objeto `{base64}`. A API responde
422. Do lado da resposta, o mesmo: `image` é objeto, e ler como string dá
`b64.replace is not a function`. `server/mannequin.ts` já tinha sido corrigido; os outros módulos não.

## Decisão

**1. Toda linha de ledger de uma geração paga carrega o identificador remoto.**

`character_id` e `background_job_id` para personagem, `tile_id` para tile isométrico — gravados no
ledger e no manifesto, no momento da submissão, antes de qualquer poll. O dinheiro sai na submissão;
o identificador é a única forma de voltar ao artefato quando o download falha depois.

**2. Andamento é resposta com status nomeado, nunca 404.**

`GET /api/sprite-lab/{hash}` e `GET /api/world-block/{hash}` respondem 200 com
`{status: 'gerando' | 'pronto' | 'falhou' | 'desconhecido'}`. O único 404 que sobra nessas rotas é
hash malformado, e ali ele significa mesmo "recurso inexistente".

**3. O formato `Base64Image` tem uma definição só.**

`server/base64-image.ts` concentra `asBase64Image` (montar request) e `extractBase64` (ler resposta,
aceitando objeto e string). Duas cópias da mesma regra é como uma delas fica para trás — foi
exatamente o que aconteceu.

## Consequências

**Um servidor reiniciado no meio da geração deixa de ser mistério.** O mapa de jobs é volátil; quando
o hash não tem manifesto nem job, a rota responde `desconhecido` com a explicação, e a tela mostra na
hora. A heurística de 15 segundos que existia na tela foi removida — ela dependia do mesmo snapshot
que não era renovado, então nunca disparava.

**A sondagem do estúdio passou a ser incondicional.** Um GET local a cada três segundos numa
ferramenta de usuário único; o custo de não sondar foi uma tela travada em cima de geração já paga.

**Editar `tools/character-builder/server/*.ts` reinicia o Vite e mata geração em voo.** O
`vite.config.ts` importa `server/api.ts`, então qualquer alteração ali derruba o processo — e com ele
os jobs em andamento e o mapa de jobs. Isso é comportamento do ambiente de desenvolvimento, não bug, e
está registrado porque custou uma geração durante a própria correção. Com a regra 1, o artefato
sobrevive.

**A suíte passou a modelar a resposta real.** Os clientes falsos devolvem metadado no job e
`rotation_urls` como URLs em `GET /characters/{id}`, servidas por um `fetch` interceptado. Quatro
testes de regressão fixam o caminho dos pixels da v3, e é por eles que a próxima mudança de fornecedor
vai aparecer.

## O que continua não verificado

Se a PixelLab passar a devolver pixels no background job, `extractBase64` os aceitaria, mas o código
continuaria buscando o `CharacterDetail` — uma requisição extra, não um erro. Não há sinal de que isso
vá acontecer, e não vale código condicional preventivo.

## Referências

- [`tools/character-builder/server/character-detail.ts`](../../tools/character-builder/server/character-detail.ts) — a espera pelas `rotation_urls`
- [`tools/character-builder/server/base64-image.ts`](../../tools/character-builder/server/base64-image.ts) — a definição única do formato
- [`tools/character-builder/server/sprite-lab.test.ts`](../../tools/character-builder/server/sprite-lab.test.ts) — os testes de regressão do caminho dos pixels
- [ADR 0012](0012-guard-de-orcamento-informativo.md) — o guard informa e nunca recusa
- [ADR 0019](0019-create-character-v3-e-o-caminho-do-personagem.md) — a decisão de usar a v3, que esta ADR faz funcionar

**Última atualização:** 2026-08-01
