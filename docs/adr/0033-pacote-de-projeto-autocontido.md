# ADR 0033 — Pacote de projeto autocontido: mapa, personagem e blocos num arquivo só

> **Quick Start (TL;DR)**
>
> O projeto inteiro — mapa exportado (v2), bundle do personagem e os PNGs dos
> blocos gerados — passa a caber num ÚNICO JSON (`ProjectBundleV1`), com os PNGs
> embutidos em base64. Dois endpoints novos fazem a ponte: exporta o pacote
> (POST /api/project/export) e o restaura (POST /api/project/import). Bloco que
> não está no pacote degrada para o cubo procedural que o editor já desenha.
>
> ```bash
> cd /home/ondokai/Projects/isometric-maker/tools/character-builder && npx tsc --noEmit
> ```

**Status:** aprovada · **Data:** 2026-08-02

## Contexto

O editor exporta as três partes do projeto em formatos separados e com destinos
diferentes:

- o **mapa** sai como `mapa.json` (MapExportV2, [ADR 0027](0027-exportacao-v2-instancias-e-materiais.md)), gerado no cliente pelo botão "Exportar JSON" do editor de mapa;
- o **personagem** sai como bundle do wizard (`sprite-wizard-directions`), baixado do estúdio;
- os **blocos gerados** não saem em lugar nenhum: os PNGs pagos moram em `assets/world-blocks/` da máquina local, e cada bloco é referenciado no mapa apenas pelo hash.

Levar um projeto para outra máquina (ou guardar um backup fiel) exigia exportar
três artefatos em três formatos e copiar a pasta de assets à parte — e nada
garantia que o destino tivesse os blocos com os mesmos hashes. O mapa carregava
referências de arte que o destino não tinha como resolver.

O padrão de bundle embutido já existe no produto: o `WizardBundle` carrega os
PNGs do personagem em base64 dentro do próprio JSON. O pacote de projeto
estende esse mesmo padrão ao mapa e aos blocos.

## Decisão

**1. Formato único `ProjectBundleV1`, autocontido, com campo `version`.**

```typescript
interface ProjectBundleV1 {
  readonly version: 1;
  readonly name: string;
  readonly map: MapExportV2;            // a exportação do editor de mapa
  readonly character: WizardBundle | null; // null quando não há personagem pronto
  readonly blocks: Record<string, string>; // hash do bloco → base64 do primeiro frame
  readonly createdAt: string;           // data ISO
}
```

O discriminador `version` segue a regra da [ADR 0018](0018-artefato-de-exportacao.md):
inteiro literal, verificado antes de qualquer leitura — versão desconhecida é
recusa nomeada, nunca adivinhação.

**2. PNGs em base64 dentro do JSON — o arquivo é grande, e é portável.**

Cada bloco entra como hash → base64 do primeiro frame (`north.png` no formato de
4 vistas, `base.png` no formato de textura). O personagem já viaja assim pelo
`WizardBundle`. A alternativa — caminhos relativos a sidecars, como o `ProjectV1`
da ADR 0018 — não serve aqui: o pacote tem que abrir numa máquina sem a pasta de
assets, e um projeto é um arquivo, não um diretório.

**3. Bloco ausente degrada, nunca quebra.**

Se o pacote referencia um hash que não existe (o PNG sumiu do disco na origem,
ou o export não o leu), o bloco simplesmente não entra no pacote. No destino,
um bloco de mapa que não está no catálogo já cai no cubo procedural — é o
comportamento atual de `definitionOf` no `block-catalog.ts`, que devolve
`fallbackDefinition` para id desconhecido. A degradação é herdada, não inventada.

**4. Dois endpoints, no mesmo padrão das rotas existentes (validação total antes
de escrever, erros nomeados em pt-BR, 400 para pedido errado).**

- **POST /api/project/export**, corpo `{ map: MapExportV2 }`: carrega o estúdio,
  lê o bundle do primeiro personagem (a mesma lógica do export do wizard — sem
  personagem pronto, o campo `character` sai `null`, sem erro), lê o primeiro
  frame de cada hash referenciado na `palette` do mapa e devolve o
  `ProjectBundleV1`.
- **POST /api/project/import**, corpo `ProjectBundleV1`: restaura o personagem
  como personagem NOVO com o nome do projeto (a mesma lógica de
  POST /api/characters/import), grava cada bloco do pacote em
  `assets/world-blocks/<hash>/` como cubo base estático (manifesto v3 com
  `animated: false`) e devolve `{ success: true, characterId, blockCount }`.

**5. A arte importada é a base estática, não a animação nem as 4 vistas.**

O pacote carrega um PNG por hash. No destino, o bloco é registrado no catálogo
como textura estática (manifesto v3, `frameCount: 0`) — a paleta o oferece, o
mapa o desenha, e a geração completa (animação ou 4 vistas) é uma compra nova
se o usuário quiser. O manifest mínimo é o que `listWorldBlocks` já aceita;
regerar com a mesma configuração no destino reaproveita o `base.png` e só paga
o que faltar.

## Alternativas descartadas

**Pacote referencial (caminhos + sidecars), como o ProjectV1.** Rejeitado: o
destino teria a forma sem a arte, e copiar assets à parte recria o problema que
o pacote existe para resolver.

**Baixar os blocos da PixelLab de novo no destino.** Rejeitado por dinheiro: a
regra de custo do repositório é que gerar de novo só é grátis quando o artefato
já está em disco — no destino, não está, e reimportar cobraria de novo por arte
já paga na origem.

**Empacotar em ZIP.** Rejeitado: um arquivo só é mais simples de guardar, mover
e colar, e o precedente do WizardBundle já é JSON com base64. ZIP só se o
tamanho virar problema de verdade — aí sim, com ADR nova.

## Consequências

- **Arquivo grande.** Base64 infla os bytes em ~33 %, e um projeto com muitos
  blocos gerados pode chegar a alguns MB. O trade-off é aceito: portabilidade
  vale mais que tamanho, e o JSON continua inspecionável com grep e diff.
- **O personagem importado nasce com o nome do projeto.** Reimportar o mesmo
  pacote na mesma máquina esbarra no conflito de id do personagem (erro nomeado,
  como em POST /api/characters/import) — comportamento honesto, não silencioso.
- **Blocos importados são estáticos até serem regerados.** A textura base
  viaja; animação e 4 vistas não. A paleta do destino mostra o bloco como peça
  estática, sem fingir que a animação veio junto.
- **O mapa viaja, mas não é restaurado pelo import.** O servidor restaura
  personagem e blocos e devolve o id; a tela navega ao editor de mapa. Carregar
  o `map` do pacote dentro do editor é trabalho futuro — o campo já está no
  formato, e o formato não muda para acomodá-lo.
- **Nada disto toca o catálogo da PixelLab nem o hash de custo.** O pacote é
  filesystem puro: importar não gasta dinheiro, exportar não gasta dinheiro, e
  nenhuma regra de idempotência de custo muda.

## Referências

- [`ADR 0027`](0027-exportacao-v2-instancias-e-materiais.md) — o formato do mapa embutido no pacote, vigente
- [`ADR 0018`](0018-artefato-de-exportacao.md) — o precedente do artefato de projeto e a regra do discriminador de versão, vigente
- [`ADR 0023`](0023-caminho-de-volta-ao-artefato-pago.md) — o motivo pelo qual reimportar sem o PNG não é "regenerar de graça", vigente
- `/home/ondokai/Projects/isometric-maker/tools/character-builder/server/api.ts` — os dois endpoints novos
- `/home/ondokai/Projects/isometric-maker/tools/character-builder/server/sprite-bundle.ts` — o WizardBundle e a lógica de import reutilizada
- `/home/ondokai/Projects/isometric-maker/packages/iso-core/src/block-catalog.ts` — `fallbackDefinition`, a degradação herdada

**Última atualização:** 2026-08-02
