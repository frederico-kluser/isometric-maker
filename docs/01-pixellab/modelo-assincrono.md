# O modelo assíncrono de jobs

> **Quick Start (TL;DR)**
>
> **23 dos 56 endpoints POST** devolvem `202` + `background_job_id`. Você paga no submit e busca o resultado depois. Guarde o id em disco **antes** do primeiro poll.
>
> ```bash
> node /home/ondokai/Projects/ferro-e-cinzas-skills/pixellab-assets/scripts/inspect-spec.mjs \
>   /home/ondokai/Projects/ferro-e-cinzas/tools/pixellab-pipeline/openapi/openapi-v2.json --list
> ```

## O que é síncrono e o que não é

Dos 56 endpoints POST, **23 declaram `202`**. Desses, 21 são exclusivamente assíncronos; dois — `/create-tileset` e `/create-isometric-tile` — declaram **`200` e `202`**, ou seja podem responder das duas formas. Trate-os como assíncronos e aceite o `200` como atalho.

Os síncronos são a família de imagem e esqueleto: `create-image-pixflux`, `create-image-pixen`, `create-image-bitforge`, `animate-with-skeleton`, `estimate-skeleton`, `rotate`, `inpaint`, `image-to-pixelart`, `resize`, `remove-background`.

Guias antigos afirmam o contrário — que a v2 é síncrona e o MCP é assíncrono. Está invertido para a maior parte da superfície.

## O ciclo

```text
POST /v2/<endpoint>                  → 202 { background_job_id, [resource_id] }
                                        ^ o dinheiro saiu AQUI
GET  /v2/background-jobs/{job_id}    → { status: processing | completed | failed }
                                        poll a cada 5–10 s
```

Latências observadas, verbatim do `api.pixellab.ai/mcp/docs` (2026-07-29):

| Operação | Típico |
|---|---|
| Maioria das criações | **2 a 5 minutos** |
| Animação | ~2 a 4 minutos |
| Objeto de mapa, 1 direção | 15 a 30 segundos |
| Objeto de 8 direções | ~2 a 4 minutos |

> *"The tools are non-blocking - they return job IDs immediately and process in the background (typically 2-5 minutes)"*

## A invariante que organiza o pipeline

**O dinheiro sai no `submit`; o valor chega no `download`.** Entre os dois momentos, o id do job é a única coisa entre você e pagar duas vezes.

Portanto, sem exceção: grave o id em disco com escrita atômica (arquivo temporário + `rename`) **antes do primeiro poll**. Um `Ctrl+C`, um OOM ou uma queda de rede depois disso custa tempo, não dinheiro — porque o comando de retomada repola em vez de resubmeter.

**Nunca resubmeta um job cujo id você tem.** É o bug mais caro possível neste sistema.

## Códigos de erro, incluindo os estranhos

| Código | Significado | Retentar? |
|---|---|---|
| **429** | `Too many concurrent jobs` / `Concurrency limit reached` | sim, honrando `Retry-After` |
| **529** | `Rate limit exceeded` | **sim** — e quase nenhum cliente HTTP trata 529 como retentável |
| **423** | `Locked`: objeto de mapa ainda gerando, com `Retry-After` | sim |
| **410** | `Gone`: geração falhou em definitivo | não |
| **404** | não existe job desse id para este usuário | não |
| **422** | forma inválida — bug seu, e já custou | **não** |
| **402** | saldo insuficiente | não |

O **529** é o mais perigoso porque é silencioso: está declarado em **13 endpoints**, essencialmente toda a família síncrona (`create-image-pixflux`, `create-image-pixen`, `create-image-bitforge`, `animate-with-skeleton`, `animate-with-text`, `estimate-skeleton`, `rotate`, `inpaint`, `tilesets`, `create-tileset`, `tilesets-sidescroller`, `create-tileset-sidescroller`, `create-isometric-tile`). Um cliente que só trata 429 falha sem retry justo nos endpoints mais chamados.

## `/map-objects` tem contrato próprio

Não use o poll genérico. `GET /map-objects/{object_id}` responde:

- `200` com metadados e `download_url` quando pronto
- **`423 Locked`** com `Retry-After` enquanto gera
- **`410 Gone`** quando falhou em definitivo
- `404` quando não existe job desse id

E o artefato **auto-deleta 8 horas depois da criação**. A doc oficial diz literalmente: *"Map objects auto-delete 8h after creation — grab the PNG promptly."* Modele o prazo como dado (conclusão + 8 h − 1 h de margem) e dê prioridade de download sobre novos submits.

## Concorrência

**Não existe endpoint de lote.** "Lote" significa enfileirar em paralelo até o limite de concorrência da conta. O tier de US$ 50/mês declara **até 20 jobs simultâneos**; a concorrência dos tiers menores não está documentada e precisa ser medida.

Duas regras que evitam ficar permanentemente limitado:

- **Semáforo ponderado, não contado.** Um `create-character-pro` custa muito mais trabalho ao servidor que um tileset, e o limite é sobre trabalho. Peso por endpoint.
- **Em 429/529, reduza a taxa global**, não só a do job. Sem isso, 20 workers retentando independentemente formam thundering herd. Backoff exponencial com **full jitter**, e `Retry-After` sempre vence o cálculo.

## Poll adaptativo

5 s nos primeiros 30 s, 10 s depois, com teto absoluto. Ao estourar o teto, marque o job como travado — **mantendo o id** — e siga adiante. A retomada pega depois. Não trate timeout como falha: o job provavelmente vai completar, e você já pagou.

## Referências

- `https://api.pixellab.ai/mcp/docs` — latências, verificado 2026-07-29
- O spec vendorizado em `/home/ondokai/Projects/ferro-e-cinzas/tools/pixellab-pipeline/openapi/openapi-v2.json`
- Implementação: `src/api.ts` (transporte e poll) e `src/queue.ts` (estado à prova de queda)

**Última atualização:** 2026-07-29
