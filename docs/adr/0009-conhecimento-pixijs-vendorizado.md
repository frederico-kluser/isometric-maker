# ADR 0009 — Conhecimento do PixiJS vendorizado, não escrito de memória

> **Quick Start (TL;DR)**
>
> O `pixi.js` 8.19.0 é fixado e vendorizado em `/home/ondokai/Projects/power-abuse/tools/pixi-reference/`: os tipos completos **e** as 26 skills oficiais que o próprio pacote publica. As skills deste repositório **citam** esse vendor e nunca reescrevem a API.
>
> ```bash
> node /home/ondokai/Projects/power-abuse/tools/pixi-reference/scripts/vendor-types.mjs --check
> node /home/ondokai/Projects/power-abuse/.agents/skills/scripts/check-pixi-claims.mjs
> ```

**Status:** aceita · **Data:** 2026-07-30

## Contexto

A [ADR 0001](0001-pixijs-em-vez-de-cocos.md) escolheu PixiJS 8, mas não existe uma linha de código PixiJS neste repositório. O conhecimento para escrever o cliente teria que vir da memória do modelo — e é exatamente aí que este repositório já se queimou uma vez.

O `AGENTS.md` tem regra dura contra escrever sobre a API do PixelLab de memória, porque ela muda sem versionar. O PixiJS tem o mesmo problema por um caminho diferente, e pior:

- A v8 **substituiu** partes da v7, não apenas acrescentou. `BaseTexture` virou `TextureSource`, o construtor síncrono de `Application` virou construtor mais `init` assíncrono, o desenho vetorial inverteu a ordem das chamadas.
- **A v8 manteve os métodos da v7 como shims marcados `@deprecated`.** São **97 declarações deprecadas** no snapshot fixado. Código v7 escrito de memória **compila limpo** e falha só no navegador, ou nunca — opções ignoradas em silêncio, aviso só em modo de desenvolvimento.

Um modelo que "lembra PixiJS" lembra uma mistura de duas APIs incompatíveis, e a mistura passa no compilador.

Levantamento feito para esta decisão trouxe um segundo fato, que muda o desenho: **o pacote `pixi.js` publica 26 Agent Skills dentro do próprio npm**, em `skills/`, licença MIT, sincronizadas a cada release. São 64 arquivos e cerca de 7.100 linhas descrevendo a API — um router mais 25 skills especializadas.

## Decisão

Vendorizar, com proveniência, e citar em vez de reescrever.

1. `tools/pixi-reference/` fixa `pixi.js` na versão exata **8.19.0**. Não é o cliente e não pretende ser.
2. `vendor/pixi-api.d.ts` guarda as 47.533 linhas de declaração de tipos. É a única fonte capaz de responder "essa classe ou membro existe mesmo" sem rede.
3. `vendor/skills/` guarda as 26 skills oficiais, verbatim, com a licença MIT junto.
4. `vendor/manifest.json` e `vendor/PROVENIENCIA.txt` registram versão, data e sha256 por arquivo.
5. As skills deste repositório **não repetem a API**. Elas carregam o que o upstream não pode saber — a ordem canônica `S, SW, W, NW, N, NE, E, SE`, o contrato de atlas do pipeline, a âncora nos pés, alvo travado, permadeath — e delegam a pergunta de API para a skill upstream correspondente.
6. `check-pixi-claims.mjs` confere toda afirmação: símbolo existe, **não está deprecado**, skill upstream citada existe, versão citada bate com o manifesto, vendor íntegro.

As skills upstream ficam sob `tools/`, **não** sob `.agents/skills/`, porque o frontmatter delas (chave `license`, nomes fora de gerúndio, sem bloco `metadata`) reprovaria no linter deste repositório em todos os arquivos. Elas são material citado, não skills nossas.

## Alternativas consideradas

- **Escrever dez skills completas de API, autocontidas.** Rejeitada: duplicaria cerca de 7.100 linhas de documentação oficial que envelhecem a cada release, e este repositório não tem CI para detectar o drift. É o erro da regra 8 do `AGENTS.md` — copiar doc upstream literalmente.
- **Depender da documentação online.** O PixiJS publica um índice legível por máquina em `https://pixijs.download/release/docs/llms.txt`, regenerado a cada release. Ótimo como fallback, ruim como fonte de verdade: não é reproduzível, não é verificável offline e não permite o gate de escrita que este sistema usa. Continua registrado como último recurso.
- **Vendorizar só o `.d.ts`.** Mais leve, mas joga fora a prosa que o upstream mantém — e a prosa é justamente o que explica *quando* usar cada coisa.
- **Não vendorizar nada e marcar tudo como não verificado.** Honesto, e inútil: nenhuma afirmação teria como ser checada, e o `verification_signal` das skills de PixiJS seria vazio.

## Consequências

- Entram **2,4 MB** no git — 66 arquivos. O `node_modules` (~80 MB) continua fora.
- **Subir de versão deixa de ser silencioso.** Muda o pin, regenera, e cada erro do checker vira item de changelog. É o oposto de descobrir a mudança em produção.
- **O vendor é gerado, não editado.** Editar um arquivo ali quebra o `--check` de propósito.
- Depende de o pacote continuar publicando `skills/`. Isso **não é contratual**. Se parar, o script falha explicitamente em vez de vendorizar pela metade, e a decisão volta para a mesa.
- Existe um custo de disciplina: toda afirmação nova sobre PixiJS precisa passar pelo checker antes de virar skill. Foi o que pegou, durante a escrita, uma citação de `Container.name` (deprecada desde a 8.0.0) e uma de `Direction` que era enum do PixelLab, não do PixiJS.

## O que não foi verificado

- **Nada neste repositório jamais renderizou um quadro.** As skills de PixiJS não têm baseline de desempenho, e dizem isso.
- **Compatibilidade dos pacotes da comunidade com a 8.19.0** — tilemap, UI e layout. Nenhum está instalado e o levantamento não conseguiu estabelecer suporte. As skills registram isso como pergunta aberta em vez de escolher.
- **Estabilidade do `ParticleContainer`**: três artefatos do mesmo pacote se contradizem — os tipos empacotados marcam `@standard`, a skill oficial diz "stable for production use", e os tipos por módulo trazem um aviso `EXPERIMENTAL`. Registrado, não resolvido.
- Renderização sob servidor autoritativo (interpolação de snapshots) **não tem cobertura nenhuma** no material oficial. A skill que trata disso é a de evidência mais fraca do conjunto e está rotulada como tal.

## Referências

- [`/home/ondokai/Projects/power-abuse/tools/pixi-reference/README.md`](../../tools/pixi-reference/README.md) — o que é vendorizado e como regenerar
- [`/home/ondokai/Projects/power-abuse/.agents/skills/routing-pixijs-work/SKILL.md`](../../.agents/skills/routing-pixijs-work/SKILL.md) — o sub-router que consome o vendor
- [`/home/ondokai/Projects/power-abuse/.agents/skills/catalog.md`](../../.agents/skills/catalog.md) — as dez skills de ponte
- [ADR 0001](0001-pixijs-em-vez-de-cocos.md) — a escolha do PixiJS 8
- [ADR 0002](0002-cliente-rest-gerado-do-openapi.md) — o mesmo padrão de vendorização, aplicado antes ao spec do PixelLab

**Última atualização:** 2026-07-30
