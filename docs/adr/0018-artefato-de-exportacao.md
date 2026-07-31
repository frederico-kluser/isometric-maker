# ADR 0018 — O artefato de exportação: `project.json` v1

> **Quick Start (TL;DR)**
>
> O projecto é serializado num único ficheiro JSON com `schemaVersion: 1` como descriminador de versão. A geometria é guardada como dado, os atlas como caminhos relativos a sidecars `.pixellab.json`, e a escrita é atómica. O campo `mapa` está reservado para a F2-02.
>
> ```typescript
> interface ProjectV1 {
>   readonly schemaVersion: 1;
>   readonly nome: string;
>   readonly data: string;          // ISO-8601
>   readonly geometria: {
>     readonly tileWidth: number;   // 64
>     readonly tileHeight: number;  // 32
>     readonly zStep: number;       // 16
>   };
>   readonly atlas: readonly string[];
>   readonly mapa?: Record<string, never>;
> }
> ```

**Status:** aceita · **Data:** 2026-07-30

## Contexto

A [ADR 0010](0010-pivo-para-editor-isometrico.md) redefiniu o produto como um editor isométrico local. Com isso surgiu a necessidade de um artefato que represente o estado completo de um projecto em disco — o equivalente ao que um ficheiro `.psd` é para o Photoshop ou um `.blend` para o Blender.

A [ADR 0013](0013-geometria-isometrica-64x32-z16.md) fixou os três números da grelha isométrica (64×32×16), e a [ADR 0015](0015-low-top-down-8-direcoes-isometrico.md) definiu a perspectiva dos personagens que se assentam nela. Essas duas decisões são pré-condições para o formato: sem geometria fixa, o projecto serializado carregaria num editor que desenha tudo no sítio errado.

A implementação do formato ficou na [F0-11](../.pi/handoff/F0-11-iso-core-formato-projeto-v1.md), no pacote `packages/iso-core`. Este ADR formaliza as decisões de design que a F0-11 tomou e — tão importante quanto — declara explicitamente o que **não** foi decidido, para que as ondas seguintes não herdem uma decisão por omissão.

## Decisão

### D1 — JSON, UTF-8, indentação de 2 espaços

O artefato é um ficheiro `.json` com codificação UTF-8 e `JSON.stringify` com indentação de 2 espaços. Nada de YAML (o editor não é configurado à mão), nada de binário (ferramentas de diff e grep são parte do ciclo de desenvolvimento).

A indentação de 2 espaços é a convenção do ecossistema Node e minimiza a diferença visual entre o que o editor escreve e o que o `prettier` formataria.

### D2 — `schemaVersion: 1` como descriminador de versão

O primeiro campo do objecto raiz é `schemaVersion`, com o valor inteiro literal `1`. Não é string (`"1"`), não é float (`1.0`). O loader (`loadProject`) verifica **apenas** este campo e rejeita qualquer outro valor — inclusive versões futuras (`2`, `3`, …) e ausência do campo.

A verificação é mínima de propósito. O descriminador diz "este ficheiro é da família que eu sei ler". O resto da forma é confiado ao sistema de tipos, não a um validador de runtime. A justificação completa está em D7.

O tipo `Project` já está declarado como união (`Project = ProjectV1`), preparado para receber `ProjectV2` quando a segunda versão do formato for necessária — e essa evolução **exige uma ADR nova**, porque o formato é a interface mais estável do produto.

### D3 — Geometria como dado, não como constante

O objecto `geometria` contém `tileWidth`, `tileHeight` e `zStep` como números. A fábrica `criarProject` injeta os valores da [ADR 0013](0013-geometria-isometrica-64x32-z16.md) (64, 32, 16), mas o `loadProject` **confia no que está no ficheiro**.

Isto é intencional. Se a geometria fosse uma constante importada, um projecto escrito com geometria X e carregado com geometria Y exibiria o mapa no sítio errado **sem avisar**. Com a geometria no ficheiro, o editor pode detetar a discrepância e perguntar ao utilizador — ou simplesmente carregar o que está lá, porque a geometria do ficheiro é a verdade.

**Não é suportado mudar a geometria de um projecto depois de criado.** Fazer isso invalida todas as coordenadas de mapa, todas as posições de entidade e potencialmente a arte gerada. Se essa capacidade for necessária no futuro, será uma funcionalidade de migração com ADR própria.

### D4 — Atlas como caminhos relativos a sidecars `.pixellab.json`

O array `atlas` contém caminhos relativos ao directório do ficheiro de projecto. Cada entrada aponta para um ficheiro sidecar `.pixellab.json` — o artefacto que o `tools/pixellab-pipeline` gera quando empacota sprites num atlas.

A escolha de caminho relativo (e não absoluto, e não só o nome do atlas) é pragmática: um projecto movido de pasta continua a funcionar. A escolha de sidecar (e não inline, e não hash) permite que vários projectos partilhem o mesmo atlas sem duplicação, e que o pipeline regenere o atlas sem tocar no ficheiro de projecto.

### D5 — Escrita atómica via ficheiro temporário + `rename`

`saveProject` escreve para um ficheiro `.project-<uuid>.tmp` no mesmo directório que o destino e renomeia. No Linux, `rename(2)` dentro do mesmo filesystem é atómico — um leitor concurrente vê ou o ficheiro antigo completo ou o novo completo, nunca um ficheiro parcial.

Evitou-se o `tmpdir()` do sistema operativo porque `rename` entre filesystems diferentes não é atómico (cai em `EXDEV`). O directório de destino é o sítio seguro.

### D6 — O campo `mapa` está reservado para a F2-02

O tipo `ProjectV1` declara `mapa?: Record<string, never>`. Em TypeScript, `Record<string, never>` significa "objecto vazio" — não se pode atribuir propriedades sem conversão explícita. O campo existe na interface para o formato ser serializável desde o dia 1, mas o seu conteúdo pertence à task F2-02.

Quando a F2-02 definir o formato real do mapa, este tipo será substituído. Não é possível fazer merge parcial: o campo será re-declarado com o tipo concreto.

### D7 — Validação de carga é mínima; o sistema de tipos é a verdade

`loadProject` valida **apenas** o descriminador `schemaVersion`. Não valida que `nome` é string, que `geometria` tem os três campos, que `atlas` é array de strings. A justificação tem três camadas:

1. **TypeScript já garante a forma em tempo de compilação.** O type-assertion `parsed as ProjectV1` após o guard `schemaVersion === 1` é a mesma técnica usada em `tools/pixellab-pipeline/src/` — o type system é a barreira primária, e o runtime só verifica o que o type system não consegue (versão desconhecida).

2. **Validação completa de runtime é um segundo sistema de tipos, mantido à mão.** Fica dessincronizado, gera falsos negativos, e o custo de o manter é maior do que o risco que mitiga — porque o ficheiro é escrito pelo editor, não editado à mão.

3. **Se a validação completa for necessária, será via JSON Schema gerado a partir dos tipos.** Essa é uma decisão separada, com custo de manutenção contínuo, e não se toma antes de existir um segundo consumidor do formato (runtime do jogo, ferramenta de linha de comando, etc.).

O risco aceite é: um ficheiro com `schemaVersion: 1` e campos em falta ou com tipos errados é carregado sem erro e pode causar uma exceção noutro ponto do sistema. A mitigação é que o editor é o único escritor, e o editor escreve o formato completo.

## Alternativas consideradas

**Formato binário (MessagePack, Protobuf).** O argumento é tamanho e velocidade de parse. Rejeitado porque o ficheiro de projecto é pequeno (coordenadas e caminhos, não assets) e a inspecionabilidade com ferramentas de texto é mais valiosa do que alguns milissegundos de parse — especialmente durante o desenvolvimento, em que se faz diff, grep e edição manual para testar cenários.

**YAML.** Rejeitado pelo mesmo motivo que JSON foi escolhido: o utilizador não edita o ficheiro à mão, e YAML introduz ambiguidades ( `no` como `false`, indentação significante) sem benefício correspondente.

**Geometria como constante importada da ADR 0013.** Rejeitado porque tornaria o formato frágil a uma mudança global: se a geometria padrão mudasse, todos os projectos antigos carregariam com a nova geometria e exibiriam o mapa no sítio errado, sem que nada no ficheiro indicasse a discrepância.

**Validação completa de schema no `loadProject`.** Rejeitada para a v1 pelo argumento em D7. Não é uma rejeição permanente — é uma decisão de não investir nisso antes de existir um segundo consumidor do formato.

## Consequências

- **O `iso-core` é o pacote raiz da árvore de dependências do editor.** Está em `packages/`, não em `tools/`, e nunca importa de `tools/`. A fronteira é: `packages/` = bibliotecas de runtime, `tools/` = ferramentas de build-time. O editor importa de `packages/iso-core`; o pipeline não importa de `packages/` (o pipeline gera assets, não os consome).
- **Adicionar um campo ao formato requer:** (a) declará-lo na interface `ProjectV1`, (b) preenchê-lo na fábrica `criarProject`, (c) verificar que `saveProject`/`loadProject` não precisam de alteração, e (d) se o campo tiver semântica de integridade (ex.: `atlas` tem de ser array de caminhos válidos), pesar se a validação de runtime já se justifica ou se continua adiada.
- **Mudar a geometria padrão requer:** alterar `GEOMETRIA_PADRAO` e a [ADR 0013](0013-geometria-isometrica-64x32-z16.md) (ou uma ADR nova que a substitua). Projectos existentes mantêm a geometria com que foram criados, porque ela está no ficheiro.
- **Criar a versão 2 do formato requer uma ADR nova.** O mecanismo é: declarar `ProjectV2` com `schemaVersion: 2`, adicioná-lo à união `Project`, e ensinar `loadProject` a reconhecer o novo descriminador. A ADR 0018 não será editada — será substituída.
- **Custo:** nenhum em runtime ou em API. O formato é local, não depende de serviços externos, e o ficheiro é pequeno (ordem de grandeza: 1 KB por projecto vazio).

## Guarda executável

O contrato descrito nesta ADR é verificado pelos testes do `iso-core`. Se a forma do formato for violada — por exemplo, se `saveProject` escrever um campo com nome diferente, ou se `loadProject` aceitar uma versão desconhecida — os testes falham.

```bash
cd packages/iso-core && npm test
```

Os 6 testes cobrem:
- **round-trip:** o que `saveProject` escreve, `loadProject` lê com os mesmos valores
- **rejeição de versão:** `schemaVersion` ausente, `0`, ou `2` produz erro
- **atomicidade:** não deixa ficheiro temporário no directório de destino
- **geometria padrão:** `criarProject` preenche 64×32×16

Se os testes passam, o formato está íntegro. Se alguém alterar a interface `ProjectV1` de forma incompatível, o typecheck (`npm run typecheck`) também falha — mas essa verificação depende de `node_modules` instalado, enquanto `npm test` basta.

## O que este ADR NÃO decide

Este ADR é deliberadamente incompleto. As omissões abaixo não são acidentes — são fronteiras de responsabilidade, e cada uma tem dono:

| O que falta | Dono | Porquê |
|---|---|---|
| Formato do campo `mapa` | F2-02 | O campo existe como `Record<string, never>` — reservado, vazio. A estrutura de grelha, camadas e tiles será definida noutra ADR. |
| Formato de entidades (personagens, props, etc.) | F2-xx | Entidades não existem no formato v1. Quando existirem, serão um campo novo ou um ficheiro separado. |
| Formato de animações | F3-xx | Animações não existem no formato v1. |
| Como o editor descobre o ficheiro de projecto | F1-xx | Se é `project.json` na raiz de uma pasta, se é uma convenção de nome, se o editor abre um ficheiro arbitrário — nada disso está decidido. |
| Se o ficheiro é auto-contido ou referencial | — | Hoje é referencial (os atlas são caminhos para sidecars). Se um dia for auto-contido (assets embutidos), será uma versão nova do formato. |
| Validação de integridade dos atlas (se o ficheiro apontado existe, se é um JSON válido) | — | O `loadProject` não verifica. O editor deve fazê-lo ao abrir o projecto. |

## Referências

- [`/home/ondokai/Projects/isometric-maker/packages/iso-core/src/project.ts`](../../packages/iso-core/src/project.ts) — implementação do formato
- [`/home/ondokai/Projects/isometric-maker/packages/iso-core/src/project.test.ts`](../../packages/iso-core/src/project.test.ts) — a guarda executável
- [`/home/ondokai/Projects/isometric-maker/.pi/handoff/F0-11-iso-core-formato-projeto-v1.md`](../../.pi/handoff/F0-11-iso-core-formato-projeto-v1.md) — handoff da implementação
- [`ADR 0010`](0010-pivo-para-editor-isometrico.md) — o pivô que criou a necessidade deste formato
- [`ADR 0013`](0013-geometria-isometrica-64x32-z16.md) — a geometria que o formato serializa
- [`ADR 0015`](0015-low-top-down-8-direcoes-isometrico.md) — a perspectiva cujos sprites o atlas referencia

**Última atualização:** 2026-07-30
