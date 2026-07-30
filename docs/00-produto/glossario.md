# Glossário — o mesmo conceito em português e em inglês

> **Quick Start (TL;DR)**
>
> A [ADR 0008](../adr/0008-idioma-docs-ptbr-codigo-en.md) manda documentar em português e programar em inglês, então **todo conceito deste projeto tem dois nomes**. Esta tabela é o dicionário entre os dois. Use o termo em português na doc e na UI; use o identificador em inglês no código.
>
> ```bash
> grep -rn "zStep\|depthSort\|anchorMode" /home/ondokai/Projects/power-abuse/tools/
> ```

## Por que este documento existe antes do código

Fixar o vocabulário custa quarenta linhas agora. Descobrir na terceira onda que metade do código chama `height` o que a doc chama *nível Z* — e que `height` também é o nome da altura em pixels de uma imagem — custa uma renomeação em duas ferramentas.

Não é doc especulativa: não descreve infra que não existe, descreve as palavras que já estão sendo usadas.

## Mapa isométrico

| Português (doc e UI) | Inglês (código) | O que é |
|---|---|---|
| célula | `cell` | Uma posição `(x, y)` na grade. Não inclui altura |
| bloco | `block` | Um cubo unitário ocupando `(x, y, z)`. A unidade sólida do mapa |
| nível Z, nível de altura | `z` | Índice **inteiro** de altura. Nunca fracionário. Vale 16 px na tela |
| altura de um nível | `zStep` | Os 16 px. Constante, fixada pela [ADR 0013](../adr/0013-geometria-isometrica-64x32-z16.md) |
| losango, tile | `tile` | O sprite do chão. 64×32 px de face superior |
| aresta | `edge` | A fronteira entre duas células. É **onde a parede mora** — parede não é bloco |
| parede | `wall` | Sprite montado numa aresta. Bloqueia travessia, não ocupação |
| máscara de conexão | `mask` | Inteiro de 4 bits dizendo quais vizinhos são a mesma coisa. `bit0=N bit1=L bit2=S bit3=O` |
| autoladrilhamento | `autotile` | Escolher o tile pela máscara, em vez de à mão |
| kit de construção | `building kit` | O conjunto piso + paredes + porta + pilar + escada que a API devolve junto |
| altura da célula | *derivada* | O `z` ocupado mais alto, mais um. **Nunca armazenada** — calculada dos blocos |
| ordenação de profundidade | `depthSort` | A ordem de desenho. Chave `x + y + z` |
| degrau | `step` | Subida automática de exatamente um nível ao entrar numa célula |
| salto, pulo | `jump` | Mudança deliberada de `z`. O alcance em níveis é `jumpLevels` |

## Personagem

| Português | Inglês | O que é |
|---|---|---|
| direção | `direction` | Uma das 8. Ordem canônica `S, SW, W, NW, N, NE, E, SE` |
| ação | `action` | Parado, andando, correndo, pulando. O que a animação representa |
| quadro | `frame` | Uma imagem de uma animação |
| esqueleto | `skeleton` | Os 18 pontos articulares que a API estima e aceita |
| ponto articular | `keypoint` | Um dos 18, com `x`, `y`, `label` e `z_index` |
| silhueta | `silhouette` | O tipo de corpo. Peça de guarda-roupa só vale dentro da mesma |
| guarda-roupa | `wardrobe` | O conjunto de peças aplicáveis a um corpo |
| pose | `pose` | Um ciclo de animação registrado no editor |
| arte de referência | `reference image` | A imagem que o usuário anexa. Tem que olhar para o sul |
| altura declarada | `heightPx` | A altura em pixels que o usuário informa ao anexar, e que reescala o esqueleto |
| âncora | `anchor` | O ponto do sprite que corresponde à posição no mundo. Medido, não fixo |

## Geração e custo

| Português | Inglês | O que é |
|---|---|---|
| geração | `generation` | A unidade de cobrança da PixelLab. Não é "uma imagem" |
| catálogo | `catalog` | A lista de assets que o pipeline sabe produzir |
| identidade do asset | `specHash` | O hash que decide se algo precisa ser gerado de novo |
| hash de entrada | `inputHash` | Hash dos **pixels decodificados**, não dos bytes do arquivo |
| trava, lockfile | `lockfile` | O que já foi gerado e pago. Versionado no git |
| razão, livro-caixa | `ledger` | O registro append-only de cada gasto. Versionado no git |
| estimativa | `estimate` | Custo previsto antes de submeter. Sempre **preço estimado** |
| atlas, folha de sprites | `atlas` | O PNG empacotado mais o JSON que o PixiJS lê |
| arquivo lateral | `sidecar` | O JSON com a semântica de jogo, que não polui o JSON do PixiJS |

## Editor

| Português | Inglês | O que é |
|---|---|---|
| projeto | `project` | O arquivo que guarda personagens, mapa e regras. O artefato exportado |
| prévia | `preview` | A tela que mostra o personagem animado |
| onda | *wave* | Uma fatia de trabalho do plano. Termo de planejamento, não de código |

## Armadilhas de vocabulário

- **`height` é ambíguo e por isso não se usa sozinho.** Em imagem é altura em pixels; em mapa é nível Z. No código: `heightPx` para pixels, `z` para nível.
- **Parede não é bloco.** Bloco ocupa célula; parede ocupa aresta. Confundir os dois é o bug clássico de atravessar parede na diagonal, porque o teste de ocupação passa e o de travessia nunca é feito.
- **"Geração" não é "imagem".** Um pedido de 8 direções pode custar 1 geração e devolver 8 imagens; outro pode custar 40 e devolver as mesmas 8.
- **"Direção" tem três ordenações diferentes na API do PixelLab.** Por isso o código lê por **nome**, nunca por índice. Ver [ADR 0015](../adr/0015-low-top-down-8-direcoes-isometrico.md).

## Referências

- [`ADR 0008`](../adr/0008-idioma-docs-ptbr-codigo-en.md) — a divisão de idioma que obriga este glossário
- [`ADR 0013`](../adr/0013-geometria-isometrica-64x32-z16.md) — `zStep`, `tile`, e o Z inteiro
- [`ADR 0016`](../adr/0016-ui-ptbr-strings-centralizadas.md) — onde as strings em português moram no código
- `/home/ondokai/Projects/power-abuse/tools/pixellab-pipeline/src/endpoints.ts` — `DIRECTIONS_8`, a ordem canônica

**Não verificado:** os termos de mapa (`edge`, `mask`, `depthSort`, `jumpLevels`) ainda não existem em código nenhum — são o vocabulário acordado para quando existirem, não a descrição de algo escrito.

**Última atualização:** 2026-07-30
