# Character Builder

> **Quick Start (TL;DR)**
>
> Tela de autoria: modelo base nu e careca nas 8 direções, poses, e guarda-roupa que vale para todos os personagens. O token nunca chega ao navegador.
>
> ```bash
> cd /home/ondokai/Projects/isometric-maker/tools/character-builder
> export PIXELLAB_SECRET="..."
> npm run dev        # http://localhost:5174
> ```

## A ideia

Um personagem é **um corpo base** — careca, sem roupa, sem opinião visual — rotacionado nas 8 direções **uma vez**. Todo o resto é derivado dele: poses, roupas, armas.

Isso não é preferência de organização. É o que mantém a arte coerente e a conta pequena: derivar preserva identidade e paleta, gerar do zero não.

```text
arte de referência (sul, ≤256px) ─┐
                                  ├─► create-character-v3 ──► corpo base, 8 direções
descrição em texto ───────────────┘                                │
                                                                   ├─► animate-character ─────► poses × 8 direções
                                                                   └─► create-character-state ─► roupa/arma × 8 direções
```

## O que a tela faz

**Grade de poses × 8 direções.** Cada célula mostra o estado real: vazio, gerando, pronto ou falhou. Passar o mouse numa célula pronta **anima o ciclo**, então dá para julgar uma caminhada sem abrir nada.

**Anexar arte de referência.** Arraste um PNG virado para o sul. Com referência anexada, o `create-character-v3` rotaciona **essa arte** nas 8 direções em vez de inventar um corpo. Sem ela, o corpo vem do texto da descrição.

**Cadastrar pose nova.** Três caminhos, em ordem de custo e de controle:

| Caminho | Custo | Quando usar |
|---|---|---|
| `template` | **1 geração por direção** | quando existe template nativo |
| `action` (texto livre) | ~1 por direção até 96px, escala acima | quando não existe |
| `skeleton` | 1 direção por vez | pose que nenhum texto descreve |

**Guarda-roupa.** Cada peça é uma edição aplicada sobre o corpo base e propagada nas 8 direções pelo `create-character-state`, que devolve um `group_id` ligando o estado ao corpo de origem. Há opção de travar na paleta do corpo, contra deriva de cor.

**Silhueta é uma restrição real, não um rótulo.** Uma peça só vale entre personagens da **mesma silhueta** — o LPC prova isso na prática: 87% das suas 768 definições de item apontam para pastas compartilhadas por tipo de corpo, e um item que omite um tipo é irrenderizável nele. O estúdio modela `silhouette` como campo e **recusa a combinação impossível antes de gastar**, em vez de gerar uma peça que nunca vai servir.

## O detalhe que muda o desenho

**Só existem 10 templates de animação**, verificados no spec vendorizado em 2026-07-29:

```text
angry · attack · attack-back · attack-left · attack-right
backflip · bark · breathing-idle · cross-punch · crouched-walking
```

**`walk`, `run` e `jump` não estão na lista.** O mais próximo de caminhar é `crouched-walking` (agachado) e o mais próximo de pular é `backflip` (mortal para trás) — os dois são outra coisa.

Por isso as poses embutidas *Caminhando*, *Correndo* e *Pulando* nascem como `action`, com texto livre, e não como template. Fingir que existe template para elas produziria silenciosamente a animação errada, e só se descobriria olhando o sprite pronto.

## Esqueleto: os 18 keypoints

Para pose que nenhum texto descreve, `estimate-skeleton` devolve e `animate-with-skeleton` aceita:

```text
NOSE · NECK
RIGHT/LEFT SHOULDER · ELBOW · ARM
RIGHT/LEFT HIP · KNEE · LEG
RIGHT/LEFT EYE · EAR
```

Cada um com `x`, `y`, `label` e `z_index`. O `z_index` é o que resolve o braço passar na frente ou atrás do corpo conforme a direção — exatamente o problema que quebra paper-doll ingênuo.

Cadastre a pose pela tela e edite os keypoints em `studio.json`. **Ainda não há editor visual de esqueleto** — é a lacuna conhecida desta ferramenta.

## Arquitetura

```text
vite.config.ts      middleware de API no dev server — o token fica no Node
server/model.ts     modelo de autoria + estado semente
server/api.ts       rotas, registro de jobs, escrita dos PNGs
src/main.ts         a tela inteira, sem framework
studio.json         estado de autoria: versionável, diffável, no git
assets/             PNGs gerados, servidos estaticamente
```

Três decisões, e o porquê de cada uma:

- **O token nunca vai ao navegador.** Um `fetch` para `api.pixellab.ai` no cliente colocaria o segredo no devtools, e esta ferramenta gasta dinheiro real.
- **Polling, não WebSocket.** Job leva 2 a 5 minutos; o servidor é dono do registro, então recarregar a página não perde trabalho **que já foi pago**.
- **`studio.json` em vez de banco.** É dado de autoria, e dado de autoria mora ao lado do asset que descreve — com histórico no git.

## Limitações conhecidas

- **Sem editor visual de esqueleto.** Pose `skeleton` se cadastra pela tela, mas os keypoints se editam à mão no JSON.
- **Sem paper-doll em tempo de execução.** O guarda-roupa gera um personagem completo vestido, não uma camada separada — e isso é deliberado: **a API não tem primitiva de equipamento entre personagens**, e o `transfer-outfit-v2` é limitado a 3 frames por job acima de 80px. As três soluções que jogos reais usam estão em [`docs/02-personagem/guarda-roupa-e-silhueta.md`](../../docs/02-personagem/guarda-roupa-e-silhueta.md).
- **Sem aprovar/reprovar na tela.** Regerar sobrescreve. O `rejectedHashes` do pipeline resolve isso do lado do lote, mas ainda não está ligado aqui.
- **Sem guard de orçamento na tela.** O `cost.ts` do pipeline tem os tetos; o estúdio ainda não os consulta antes de submeter.

## Referências

- `/home/ondokai/Projects/isometric-maker/docs/01-pixellab/` — o manual da API
- `/home/ondokai/Projects/isometric-maker/tools/pixellab-pipeline/openapi/openapi-v2.json` — o spec, fonte de verdade
- `/home/ondokai/Projects/isometric-maker/tools/pixellab-pipeline/src/api.ts` — o transporte reaproveitado (429/529/423, backoff, poll)

**Última atualização:** 2026-07-30
