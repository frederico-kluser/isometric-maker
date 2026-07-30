# pixi-reference — a superfície do PixiJS, vendorizada e citável

> **Quick Start (TL;DR)**
>
> Isto **não é o cliente do jogo**. É uma pasta de referência: fixa uma versão exata do PixiJS e
> guarda a superfície de conhecimento dela dentro do repositório, para que as skills possam **citar**
> em vez de **lembrar**.
>
> ```bash
> node /home/ondokai/Projects/isometric-maker/tools/pixi-reference/scripts/vendor-types.mjs --check
> node /home/ondokai/Projects/isometric-maker/.agents/skills/routing-pixijs-work/scripts/inspect-pixi.mjs class Sprite
> ```

## Por que existe

O repositório já aprendeu essa lição uma vez, com o PixelLab: API descrita de memória erra em
silêncio, e guia escrito de memória apodrece sem avisar. O PixiJS tem o mesmo problema por outro
motivo — a v8 reescreveu bastante da v7 (`Graphics`, filtros, `ParticleContainer`, `BaseTexture`, o
construtor síncrono de `Application`), então um modelo que "lembra PixiJS" lembra uma mistura de duas
APIs incompatíveis.

Nenhuma skill deste repositório escreve API de PixiJS de memória. Elas citam este vendor.

## O que tem aqui

| Caminho | O que é |
|---|---|
| `vendor/pixi-api.d.ts` | 47.533 linhas de declaração de tipos. É a única fonte que responde "essa classe ou membro existe mesmo" sem rede, e é contra ela que `check-pixi-claims.mjs` confere toda afirmação feita numa skill |
| `vendor/skills/` | as **26 skills oficiais** que o próprio pacote `pixi.js` publica, com seus `references/`. São a descrição que o upstream faz da própria API, versionada junto com a biblioteca. Licença MIT, ver `vendor/skills/LICENSE` |
| `vendor/manifest.json` | sha256 de cada arquivo vendorizado |
| `vendor/PROVENIENCIA.txt` | versão, data de captura, origem e como regenerar |

As skills upstream **não são lintadas** como skills deste repositório. O linter só varre
`.agents/skills/`, e o frontmatter delas (chave `license`, nomes fora de gerúndio, sem bloco
`metadata`) reprovaria em todos os arquivos. Elas ficam sob `tools/` exatamente para que as regras do
linter continuem sendo nossas.

## Regenerar e conferir

```bash
npm install --prefix /home/ondokai/Projects/isometric-maker/tools/pixi-reference   # respeita o pin exato
npm run vendor  --prefix /home/ondokai/Projects/isometric-maker/tools/pixi-reference
node /home/ondokai/Projects/isometric-maker/tools/pixi-reference/scripts/vendor-types.mjs --check
```

`--check` confere os hashes contra o manifesto e funciona **sem** `node_modules` — que é justamente o
estado de um clone novo, onde alguém está prestes a confiar nos arquivos vendorizados. Quando o
`node_modules` existe, ele também avisa se a versão instalada divergiu do vendor.

## Armadilhas

- **O diretório `vendor/` é gerado, não editado.** Editar um arquivo ali à mão quebra o `--check` de
  propósito: vendor editado não vale como proveniência de nada.
- **Subir de versão não é rotina.** Mude o pin, regenere e trate cada erro de
  `check-pixi-claims.mjs` como item de changelog. É assim que a mudança da API aparece em vez de
  passar batida.
- **O vendor depende de o pacote continuar publicando `skills/`.** Isso não é contratual. Se uma
  versão futura parar de publicar, `vendor-types.mjs` falha explicitamente em vez de vendorizar pela
  metade, e a decisão volta para a mesa.
- **`npm install` aqui baixa ~80 MB em `node_modules`**, que é gitignorado. O que entra no git são os
  2,4 MB de `vendor/`.
- **Não foi verificado** se `@pixi/tilemap`, `@pixi/ui` ou `pixi-filters` são compatíveis com a
  8.19.0 — nada disso está instalado aqui, e a skill que toca no assunto diz isso na cara.

## Referências

- [`../../docs/adr/0009-conhecimento-pixijs-vendorizado.md`](../../docs/adr/0009-conhecimento-pixijs-vendorizado.md) — a decisão e o porquê
- [`../../.agents/skills/routing-pixijs-work/SKILL.md`](../../.agents/skills/routing-pixijs-work/SKILL.md) — o router que consome este vendor
- [`../pixellab-pipeline/openapi/PROVENIENCIA.txt`](../pixellab-pipeline/openapi/PROVENIENCIA.txt) — o mesmo padrão, aplicado antes ao spec do PixelLab

**Última atualização:** 2026-07-30
