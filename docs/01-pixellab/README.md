# PixelLab — manual do projeto

> **Quick Start (TL;DR)**
>
> Todo asset visual do jogo vem daqui. A API muda sem versionar, então a fonte da verdade é o spec vendorizado, não a memória nem os blogs.
>
> ```bash
> export PIXELLAB_SECRET="seu-token"   # https://pixellab.ai/account
> cd /home/ondokai/Projects/ferro-e-cinzas/tools/pixellab-pipeline
> node src/cli.ts balance
> ```

Cinco fatos que você precisa saber antes de escrever qualquer linha de código:

1. **Base URL é `https://api.pixellab.ai/v2`.** A v1 está deprecated e usa outros nomes de endpoint (`/generate-image-pixflux` virou `/create-image-pixflux`).
2. **A maioria das gerações é assíncrona.** 23 dos 56 endpoints POST devolvem `202` + `background_job_id`; você faz poll em `GET /background-jobs/{id}`. Latência típica de **2 a 5 minutos** por job.
3. **Custa dinheiro real por chamada** — e a variação entre modos é de até 40×. `mode='standard'` custa 1 geração; `mode='pro'` custa 20–40. Leia [`custos-e-limites.md`](custos-e-limites.md) **antes** de rodar um lote.
4. **O SDK oficial de JS não serve.** `@pixellab-code/pixellab@1.0.2` tem `api.pixellab.ai/v1` hardcoded e expõe 8 das 56 operações. Usamos cliente gerado do OpenAPI. Ver [ADR 0002](../adr/0002-cliente-rest-gerado-do-openapi.md).
5. **A consistência de estilo não vem de `seed`.** Vem de paleta forçada + imagem de referência + derivar variantes de um personagem-base em vez de gerar cada um do zero. Ver [`consistencia-estilo.md`](consistencia-estilo.md).

## Índice

| Documento | O que responde |
|---|---|
| [`autenticacao-e-saldo.md`](autenticacao-e-saldo.md) | Token, header, `GET /balance`, as duas unidades de cobrança |
| [`modelo-assincrono.md`](modelo-assincrono.md) | `202` + job id, poll, os códigos estranhos (423, 410, 529), concorrência |
| [`endpoints-personagens.md`](endpoints-personagens.md) | 8 direções, v3, Pro, `create-character-state`, proporções, templates de corpo |
| [`endpoints-animacao.md`](endpoints-animacao.md) | `template` vs `v3` vs `pro`, a biblioteca de animações prontas, custo por direção |
| [`endpoints-tilesets.md`](endpoints-tilesets.md) | Wang tiles, `corners`, `pattern_4x4`, encadeamento de biomas |
| [`endpoints-imagem.md`](endpoints-imagem.md) | pixflux, pixen, bitforge, inpaint, rotate, image-to-pixelart |
| [`endpoints-objetos-ui.md`](endpoints-objetos-ui.md) | `map-objects` (e sua expiração em 8 h), UI, fonte, retrato, lip-sync |
| [`custos-e-limites.md`](custos-e-limites.md) | **Tabela de preço estimado e limite de tamanho por endpoint** |
| [`consistencia-estilo.md`](consistencia-estilo.md) | Como fazer 2.700 imagens parecerem do mesmo jogo |
| [`autotiling.md`](autotiling.md) | Do `pattern_4x4` até terreno desenhado no PixiJS |
| [`cookbook.md`](cookbook.md) | Receitas para os casos concretos deste jogo |
| [`limitacoes.md`](limitacoes.md) | O que não funciona bem, sem marketing |
| [`licenca-e-termos.md`](licenca-e-termos.md) | Quem é dono do asset, uso comercial, Open RAIL-M, ausência de indenização |
| [`delta-vs-guia-antigo.md`](delta-vs-guia-antigo.md) | O que mudou desde `tech-docs/games/5.md` |

## As seis superfícies do PixelLab

Verificado em **2026-07-29** em `pixellab.ai/docs/ways-to-use-pixellab`:

| Superfície | Serve para nós? |
|---|---|
| Simple Web Creator | protótipo manual rápido |
| **Characters** (criador de sprites 4/8 direções) | conferir qualidade antes de automatizar |
| PixelLab Pixelorama (editor no navegador, baseado no Pixelorama open-source) | retoque |
| **Extensão para Aseprite** | retoque fino, a interface mais completa segundo a comunidade |
| **MCP** — servidor HTTP remoto em `https://api.pixellab.ai/mcp` | prototipagem conversacional dentro do agente |
| **API REST v2** | **o pipeline de produção — é aqui que vivemos** |

**Não existe plugin oficial de Godot, Unity, Blender ou Figma** (verificado em 2026-07-29: a org `pixellab-code` no GitHub tem 6 repositórios e nenhum deles é de engine). O marketing menciona "Godot-specific tooling", mas isso é um bullet dentro da seção do MCP, e nem o repositório do MCP tem ferramenta com esse nome. Se você leu o contrário em algum blog, o blog está errado.

O MCP **não é um pacote npm** — é servidor remoto. Não existe modo offline:

```bash
claude mcp add pixellab https://api.pixellab.ai/mcp -t http -H "Authorization: Bearer $PIXELLAB_SECRET"
```

## Por que este manual existe

Porque a documentação pública sobre PixelLab é sistematicamente errada em três pontos que custam dinheiro:

- Blogs dizem "1 crédito por request, 40 créditos nos modelos novos". **`40` é o campo `generations` (cota de assinatura), não créditos.** E `1 crédito = US$ 1,00`, conforme o modal *Buy Credits*. Confundir os dois erra o orçamento em 40×.
- Guias dizem que a v2 é síncrona. Quase metade dos endpoints POST não é.
- Guias apontam para o SDK oficial de JS, que está preso na v1 desde 2025-06-15.

## Referências

- [`https://api.pixellab.ai/v2/openapi.json`](https://api.pixellab.ai/v2/openapi.json) — fonte da verdade, vendorizada em `/home/ondokai/Projects/ferro-e-cinzas/tools/pixellab-pipeline/openapi/` (capturada 2026-07-29, sha256 em `PROVENIENCIA.txt`)
- [`https://api.pixellab.ai/v2/llms.txt`](https://api.pixellab.ai/v2/llms.txt) — índice legível por máquina
- [`https://api.pixellab.ai/v2/redoc`](https://api.pixellab.ai/v2/redoc) — referência navegável
- [`https://api.pixellab.ai/mcp/docs`](https://api.pixellab.ai/mcp/docs) — docs do MCP, onde estão as latências e as bandas de `generations`
- [`https://www.pixellab.ai/pixellab-api`](https://www.pixellab.ai/pixellab-api) — tabela de preço estimado por endpoint
- [`https://www.pixellab.ai/docs`](https://www.pixellab.ai/docs) — documentação de produto
- Discord oficial (~29 mil membros) — na prática a fonte mais atualizada, porque os docs atrasam

**Última atualização:** 2026-07-29
