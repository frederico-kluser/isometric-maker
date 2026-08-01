# ADR 0027 — Exportação v2: cada bloco colocado sai com id, posição, tipo e material

> **Quick Start (TL;DR)**
>
> O mapa continua sendo **autorado** como coluna RLE. Ele passa a ser **exportado** como lista de instâncias: cada bloco colocado carrega `id`, `x`, `y`, `z`, `kind` e `material` já resolvidos, mais uma tabela de materiais com propriedades físicas. Quem escreve física lê um registro autocontido, sem decodificar RLE nem carregar a paleta.
>
> ```bash
> cd /home/ondokai/Projects/isometric-maker/packages/iso-core && node --test src/map-instances.test.ts
> ```

**Status:** aceita · **Data:** 2026-08-01

## Contexto

O `BlockStore` guarda uma string por célula, em colunas RLE sem buracos. Para desenhar isso basta: a string é a chave da textura. Para física não basta nada — "grama" não diz se afunda, se escorrega, se dá para escalar.

O caminho fácil seria espalhar `if (tipo === 'agua')` pelo código de colisão. Física escrita assim é física que ninguém consegue mudar depois, e o custo aparece no primeiro material novo.

A pesquisa feita para esta tarefa procurou convenções externas para modelo de dados de mapa isométrico com física: separação definição/instância, tabelas de material com atrito e densidade, colisão AABB em grid, e as trocas entre chave `"x,y,z"`, array 3D e RLE por coluna. **Só uma afirmação sobreviveu à verificação:** o Tiled separa o tamanho da célula de grid do tamanho de renderização do tile, e documenta tile maior que a célula como comportamento pretendido, ancorado embaixo-à-esquerda. O resto do ângulo voltou vazio.

## Decisão

**Dois formatos, com papéis diferentes: RLE para autorar, lista de instâncias para exportar.**

O formato de autoria não muda. É compacto, não tem buracos, tem 500 linhas de teste em cima e é o que o editor manipula.

O formato de exportação, `MapExportV2`, traz três coisas separadas:

```json
{
  "schemaVersion": 2,
  "geometry": { "tileWidth": 48, "tileHeight": 24, "cubeHeight": 29 },
  "palette":   [{ "id": "grama", "label": "Grama", "kind": "solid", "material": "grama" }],
  "materials": { "grama": { "solid": true, "friction": 0.85, "density": 1400, "movementCost": 1, "harmful": false } },
  "blocks":    [{ "id": "b:0:0:0", "blockId": "grama", "kind": "solid", "material": "grama", "x": 0, "y": 0, "z": 0 }]
}
```

**A redundância é deliberada.** `kind` e `material` aparecem na paleta **e** em cada instância. Um consumidor de física lê `blocks` e pronto; um editor lê `palette` e não precisa varrer as instâncias. Cada leitor tem um caminho direto, e a redundância é derivada — nunca editada à mão.

**O identificador é derivado da posição: `b:x:y:z`.** Um contador exigiria estado persistido e sincronizado com desfazer e refazer; um UUID mudaria a cada salvamento e tornaria o arquivo indiferível no git. A posição já identifica a célula unicamente, porque o formato permite no máximo um bloco por célula. Consequência a saber: **mover um bloco muda o id dele** — o bloco não é uma entidade que anda, é o conteúdo de uma célula.

**Material e tipo são eixos ortogonais.** `material` é do que é feito (atrito, densidade, custo de movimento, se é sólido, se machuca). `kind` é o que é no mundo: `solid`, `platform`, `liquid`, `decoration`. Pedra pode ser cubo maciço ou laje que se atravessa por baixo — distinguir os dois é o que permite ponte, escada e telhado sem inventar um material por caso.

**A caixa de colisão é no espaço do GRID.** `aabbOf` devolve coordenadas de célula, meio-abertas em cima, para que dois blocos vizinhos se toquem sem se sobrepor. Colisão em pixel de tela num mapa isométrico é resolver em losango o que já era um cubo — e é exatamente onde a rotação de câmera quebraria tudo, porque a tela muda de vista e o mundo não.

**A ordem da exportação é determinística:** x, depois y, depois z. Nunca a ordem de inserção do `Map`, que muda entre execuções e sujaria todo diff.

## Consequências

- **A tabela de materiais é decisão deste projeto, não convenção herdada.** Os números — atrito 0,05 do gelo, densidade 7800 do metal, custo infinito da lava — são ponto de partida plausível. As densidades são as ordens de grandeza reais; atrito e custo são relativos e arbitrários. Estão numa tabela para que ajustá-los seja mexer numa tabela.
- **O material de um bloco gerado é adivinhado por palavra-chave na descrição.** `mossy cobblestone path block` casa `cobble` e vira pedra. É heurística assumida: o prompt é texto livre em inglês e nada garante a palavra certa. Quando nada casa, o material vira pedra — sólido e neutro. O usuário corrige na paleta.
- **A exportação cresce.** Um mapa de dez mil células vira dez mil objetos JSON em vez de algumas centenas de runs. É o preço de o consumidor não precisar decodificar nada, e o arquivo de autoria continua compacto.
- **`schemaVersion: 2` é do artefato de exportação, não do `project.json`.** O [ADR 0018](0018-artefato-de-exportacao.md) continua descrevendo o v1 do projeto.
- **Nada disto ainda executa física.** `iso-core` já tem colisão, movimento, degrau e pulo; eles leem o `BlockStore` direto e não passaram a consultar material. Esta ADR entrega o **dado**; usá-lo é trabalho seguinte.

## Referências

- [`ADR 0018`](0018-artefato-de-exportacao.md) — o artefato de exportação v1 do projeto
- [`ADR 0024`](0024-cubo-isometrico-canonico.md) — a geometria que a exportação declara
- `/home/ondokai/Projects/isometric-maker/packages/iso-core/src/block-catalog.ts` — materiais, tipos e a paleta
- `/home/ondokai/Projects/isometric-maker/packages/iso-core/src/map-instances.ts` — a enumeração, a caixa de grid e a exportação
- `/home/ondokai/Projects/isometric-maker/packages/iso-core/src/map-instances.test.ts` — 14 testes, incluindo a estabilidade da ordem

**Última atualização:** 2026-08-01
