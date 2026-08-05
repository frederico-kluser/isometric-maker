# ADR 0046 — O prompt do bloco passa a respeitar a descrição, e a divergência de endpoint com a ADR 0032 fica registrada

> **Quick Start (TL;DR)**
>
> A descrição em português que o usuário digita **nunca chegava** ao
> `/animate-with-text-v3`, que é o endpoint que produz os pixels finais do bloco
> animado — o material morria no estágio do cubo base, e todo bloco recebia a
> mesma ação-coringa. Sete defeitos empilhados, corrigidos juntos. E fica
> registrada uma divergência que existe desde sempre: a
> [ADR 0032](0032-textura-animada-unica-abandono-3d.md) decidiu
> `create-image-pixflux` como etapa 1 e o código **nunca** seguiu — ele usa
> `POST /create-isometric-tile` com `isometric_tile_shape: 'block'`. Migrar
> continua sendo a direção certa **se** alguém verificar que o pixflux reproduz a
> silhueta canônica, e **isso não foi verificado**.
>
> ```bash
> cd /home/ondokai/Projects/isometric-maker/tools/character-builder && node --test server/world-block.test.ts
> ```

**Status:** aceita · **Data:** 2026-08-05
**Corrige:** ADR 0032

## Contexto

O bloco animado tem dois estágios pagos: um cubo base e uma animação a partir
dele. O required do `/animate-with-text-v3` no spec vendorizado é `first_frame` +
`action` — **`action` é o único texto que aquele endpoint recebe sobre o bloco**.
Nada mais carrega a descrição.

O código mandava para o `action` uma ação vinda de uma tabela de palavras-chave.
Essa tabela é toda de regexes **em inglês**, e a descrição chega em **português**:
contra "quero um cubo de ossos" nenhum dos treze padrões casava, e todo bloco caía
na mesma string genérica. O material do usuário existia só no prompt do cubo base
— e o resultado prova, porque a animação via apenas um movimento genérico.

Havia mais seis defeitos no mesmo caminho, todos pequenos e todos na direção de
apagar a intenção do usuário. Ver "Os sete defeitos".

## Decisão

**1. A descrição é normalizada de pt-BR conversacional para uma frase nominal de
material em inglês pixel-art**, com LLM a temperatura baixa e **fallback
determinístico sem rede**. Corte no mesmo lugar nas duas pontas: antes, o caminho
do LLM cortava em 200 caracteres e o determinístico não cortava em nada, então a
mesma descrição rendia prompts de tamanhos diferentes conforme houvesse ou não
`ANTHROPIC_API_KEY` no ambiente.

**2. A dobra de diacríticos é 1 caractere por 1**, e isso é carga estrutural, não
detalhe. Em JavaScript `\w` — e portanto `\b` — é `[A-Za-z0-9_]` mesmo com a flag
`u`. Numa string que **começa** com 'á' não existe fronteira de palavra antes do
'á', então um padrão como `/\b[áa]gua\b/` nunca casa a alternativa acentuada.
Medido em 2026-08-04: aquele teste dava `false` para `'água'`, e "água" é a palavra
que a própria interface usa de exemplo. Dobrando 1:1 os índices continuam
alinhados, o que permite **casar no texto dobrado e substituir no original** —
palavra fora do glossário preserva os acentos digitados.

**3. O material entra na `action`.** Se o `action` não nomear o material, ele é
costurado dentro dela. E a geração da ação passa a receber o **material
normalizado**, não a descrição crua: contra "bone" a tabela de fallback funciona,
então a normalização conserta o fallback de graça, além de consertar o prompt.
A tabela ganhou um padrão de osso e passou de treze para catorze.

**4. O prompt do cubo só cita a imagem de referência quando o `init_image` de
fato vai no request.** O fornecedor recusa o molde com 422 e o código o remove;
antes desta correção a frase "matching the exact shape and proportions of the
reference image" continuava no prompt, **pendurada, sem referente algum**,
competindo por atenção com o material que o usuário pediu. Na resubmissão pós-422
o prompt é reconstruído sem ela.

**5. `text_guidance_scale` passa a ser enviado sempre.** O spec o descreve como
*"How closely to follow the text description"*; deixá-lo implícito era metade do
problema desta bancada. Junto, `outline`, `shading` e `detail` foram expostos na
interface, com rótulo em pt-BR e **valor em inglês** — o valor é o enum do spec.

**6. O `init_image_strength` do caminho da textura cai de 480 para 300**, que é o
default declarado no spec para o endpoint.

**7. O empacotador de folha passa a usar a dimensão real do quadro**, não 48×48
fixo. A consequência em disco e o conserto das folhas legadas estão na
[ADR 0045](0045-animacao-do-bloco-no-mapa.md).

**8. Só o ramo da textura é invalidado no hash**, por um marcador de versão da
cadeia de prompt. O **texto** não entra no hash de propósito: ele depende de haver
ou não `ANTHROPIC_API_KEY` no ambiente, e hashear isso faria uma variável de
ambiente cobrar de novo por um bloco já pago. Os ramos `chained` e `rotated`
hasheiam idêntico ao que hasheavam antes (medido). Um knob deixado no default
hasheia igual à omissão — mandar o default explícito produz a mesma arte que
omitir, e dois hashes para o mesmo artefato é pagar duas vezes.

**O custo foi contado ANTES de decidir:** existem exatamente **2 blocos pagos em
disco** na técnica da textura. Eles continuam em disco, continuam no catálogo e
continuam sendo desenhados — o hash novo não apaga nada e não regera nada sozinho.
O teto do prejuízo é 2 regerações, e só se o usuário pedir de novo, de propósito,
as mesmas duas descrições.

## Os sete defeitos

| Nº | Defeito | Efeito |
|---|---|---|
| 1 | a descrição nunca chegava ao `/animate-with-text-v3` | a animação era genérica; o material morria no cubo base |
| 2 | a tabela de ação-fallback é em inglês e a descrição vem em português | **toda** descrição em pt-BR caía na mesma string-coringa |
| 3 | `\b` não casa palavra iniciada por letra acentuada | o glossário falhava justamente em "água", o exemplo da interface |
| 4 | a frase da imagem de referência ficava no prompt sem referência | competia com o material pedido, num request sem imagem |
| 5 | `text_guidance_scale` nunca era enviado | o parâmetro que decide o quanto seguir o texto ficava implícito |
| 6 | `init_image_strength` era 480, contra o default 300 do spec | divergência não justificada do default do endpoint |
| 7 | o empacotador de folha usava 48×48 fixo | duas folhas em disco contradizem os quadros ao lado |

O defeito 1 é o central: os outros seis afinam o prompt, e ele decidia se havia
prompt.

## A divergência com a ADR 0032, e por que ela persiste

A ADR 0032 escreveu, na etapa 1 da decisão, que a imagem base sai de
`create-image-pixflux`, e derivou daí a consequência **"o `init_image` quebrado do
tile deixa de ser problema — não usamos mais `/create-isometric-tile` para blocos
novos"**.

**Isso nunca foi verdade em código.** A geração do cubo base sempre chamou
`POST /create-isometric-tile`, e o `init_image` quebrado do fornecedor continua
sendo problema: o fallback pós-422 está lá, e é ele que reescreve o prompt no item
4 acima. É a consequência declarada ao lado da decisão que está errada, não a
decisão — a ADR 0032 continua **vigente**, e é por isso que esta ADR a **corrige**
em vez de substituí-la.

**Por que o código foi para o outro lado.** O `/create-isometric-tile` tem
`isometric_tile_shape`, com o enum `thick tile | thin tile | block` e default
`block`, descrito no spec como *"block: ~50% canvas height"*. Ele desenha um **cubo
isométrico**, que é exatamente a silhueta que o editor precisa. E desde a
[ADR 0039](0039-sprite-unica-sobre-tres-faces.md) essa silhueta virou **carga
estrutural**: o UV mapeia o topo como losango e as laterais como paralelogramos,
canto a canto. Uma imagem plana de material não tem essa forma, e esticá-la sobre
o cubo produziria exatamente o defeito que a ADR 0039 descreve como
"quase certo" — que se lê como geração ruim, não como mapeamento errado.

**O ganho conhecido de migrar, com os números da tabela de custo do projeto:**

| | `create-isometric-tile` | `create-image-pixflux` |
|---|---|---|
| Peso de concorrência na tabela do pipeline | 2 | 1 |
| Latência declarada | 210–300 s | 8–20 s |
| **Preço estimado** por chamada | ~US$ 0,0166 | ~US$ 0,0079 |

Um detalhe honesto: **o peso de admissão da fila não muda**. Pela
[ADR 0042](0042-teto-de-concorrencia-mede-chamadas.md) o job da textura já pesa 1,
porque faz uma chamada por estágio. O ganho é de latência e de preço estimado, não
de simultaneidade.

**O que falta para migrar, e não foi feito:** verificar que
`create-image-pixflux` com `init_image` (o molde do cubo), `isometric: true` e
`view` reproduz a **silhueta canônica** que o UV da ADR 0039 exige. O spec declara
os três parâmetros e rotula `isometric` e `view` como *"weakly guiding"* — o que
é literalmente a palavra do fornecedor, e é exatamente o que impede afirmar o
resultado sem medir. **Isso não foi verificado, e verificar custa pelo menos uma
geração paga.** Até lá, a dívida fica registrada com valor conhecido em vez de ser
paga no escuro.

## Alternativas consideradas

**Migrar para `create-image-pixflux` agora, como a ADR 0032 decidiu.** Rejeitada
por ora: quebraria a silhueta de que o UV da ADR 0039 depende, e ninguém mediu se
os parâmetros "weakly guiding" a reproduzem. Mudar o endpoint no mesmo movimento
em que se conserta o prompt também tornaria impossível saber qual das duas coisas
melhorou o resultado.

**Traduzir a descrição inteira em vez de normalizá-la para um material.** O que o
endpoint quer é uma frase nominal de material, não uma frase conversacional
traduzida. Traduzir "quero um cubo de ossos" produz um pedido, não um material.

**Hashear o texto final do prompt.** Faria `ANTHROPIC_API_KEY` presente ou ausente
gerar hashes diferentes para o mesmo pedido — ou seja, cobrar de novo por um bloco
já pago só porque a variável de ambiente mudou. O marcador de versão da cadeia
sobe quando a cadeia muda de verdade, e é o operador humano quem o sobe.

## Consequências

- **O bloco passou a se parecer com o que o usuário pediu**, nos dois estágios.
- **Dois blocos pagos passaram a hashear diferente.** Nada foi apagado nem
  regerado; o teto do prejuízo foi contado antes e é 2 regerações voluntárias.
- **A qualidade do resultado não foi medida.** Não há comparação lado a lado
  antes/depois com arte nova, porque isso custaria gerações. O que está verificado
  é o **texto que sai** — que o material chega ao `action`, que a frase da
  referência some quando a referência some, que os parâmetros vão no request.
- **O fallback determinístico continua sendo fallback.** Ele existe para o caso de
  o LLM estar indisponível, não como caminho principal, e é heurístico por
  construção.
- **A divergência de endpoint continua aberta**, agora escrita. Isso é pior que
  resolvê-la e melhor que deixá-la só no código, onde dois comentários de interface
  ainda dizem "pixflux" e estão errados.

## O que NÃO foi verificado

- **Que o pixflux reproduza a silhueta canônica** com `init_image` + `isometric` +
  `view`. É a única pergunta que decide a migração, e ela custa uma geração.
- **Que o `init_image` do tile continue quebrado no fornecedor.** A
  [ADR 0031](0031-canvas-multiplo-de-4-e-init-image-quebrado.md) registrou o
  defeito; o fallback pós-422 é reavaliado a cada chamada, então se o fornecedor
  consertar, a primeira tentativa volta a valer sozinha — mas **não há
  reverificação registrada** desde então.
- **Que a normalização acerte fora do glossário.** Uma frase em português que não
  esteja nele passa adiante como está. Não é tradutor, e não pretende ser.
- **Que 480 fosse pior que 300.** A troca alinha o código ao default declarado no
  spec; **não houve comparação de arte** entre as duas forças.
- **O preço estimado e a latência da tabela acima são do modelo de custo deste
  repositório**, e a PixelLab rotula a própria coluna como preço **estimado**, que
  "varia com o tempo de GPU". A tabela também declara o pixflux como síncrono,
  enquanto o spec vendorizado descreve uma forma de resposta em background para
  ele — **qual das duas o fornecedor devolve na prática não foi verificado**.

## Referências

- [`ADR 0032`](0032-textura-animada-unica-abandono-3d.md) — a decisão da textura animada, cuja consequência sobre o endpoint esta ADR corrige
- [`ADR 0039`](0039-sprite-unica-sobre-tres-faces.md) — o UV canto-a-canto que torna a silhueta do cubo carga estrutural
- [`ADR 0031`](0031-canvas-multiplo-de-4-e-init-image-quebrado.md) — o `init_image` do tile quebrado no fornecedor
- [`ADR 0042`](0042-teto-de-concorrencia-mede-chamadas.md) — por que o peso de admissão do bloco animado não muda com o endpoint
- [`ADR 0045`](0045-animacao-do-bloco-no-mapa.md) — a folha reempacotada, consequência do defeito 7
- [`custos-e-limites.md`](../01-pixellab/custos-e-limites.md) — o preço estimado por endpoint
- `/home/ondokai/Projects/isometric-maker/tools/character-builder/server/world-block.ts` — normalização, prompt do cubo, ação da animação e hash
- `/home/ondokai/Projects/isometric-maker/tools/pixellab-pipeline/openapi/openapi-v2.json` — `CreateIsometricTileRequest` e `CreateImagePixfluxRequest`

**Última atualização:** 2026-08-05
