# ADR 0010 — O produto é um editor isométrico, não um MMORPG

> **Quick Start (TL;DR)**
>
> O produto passa a ser o **isometric-maker**: um editor de jogos isométricos local, de usuário único, em PixiJS 8 com arte gerada pela PixelLab. Servidor, multiplayer, netcode, permadeath e moderação saem do escopo. As ADRs 0003, 0004 e 0007 são apagadas; as 0001 e 0005 recebem sucessoras.
>
> ```bash
> ls /home/ondokai/Projects/isometric-maker/docs/adr/
> ```

**Status:** aceita · **Data:** 2026-07-30

## Contexto

Em dois dias este repositório produziu fundação e nenhum jogo: duas ferramentas de arte que rodam e passam nos verificadores, dezesseis documentos, nove ADRs e trinta skills. E **zero assets gerados, zero linhas de cliente ou servidor, PixiJS instalado em lugar nenhum**.

O que existe é infraestrutura de arte: um pipeline idempotente com guard de custo, transporte HTTP com retry e retomada, e um empacotador de atlas que já emite o formato que o PixiJS 8 espera. Nada disso é específico de MMORPG. O que era específico de MMORPG — combate, permadeath, economia, anti-cheat, servidor autoritativo — nunca passou de decisão escrita.

O usuário decidiu mudar o produto: em vez de um jogo, **a ferramenta que constrói jogos**. Um editor onde se constrói o personagem a partir de uma imagem, se desenha um mapa isométrico com altura, e se roda o resultado.

O momento importa. Como **nada jamais foi gerado**, o lockfile não existe, o ledger está vazio e o cache está vazio: nenhuma identidade de asset foi fixada, nenhuma fatura foi emitida. Renomear e mudar de endpoint hoje custa uma varredura de texto. Depois de arte paga em disco, a mesma mudança arrasta lockfile, ledger, caminhos e uma segunda cobrança de tudo.

## Decisão

O produto é o **isometric-maker**, um editor isométrico local de usuário único.

**Fora do escopo, explicitamente:** servidor autoritativo, multiplayer, netcode, protocolo de rede, sharding de zona, anti-cheat, permadeath, full loot, economia entre jogadores, moderação e GMs. Não há jogadores — há um usuário, na própria máquina.

Reintroduzir qualquer um desses itens exige ADR nova. A lista existe para que o MMORPG não volte a crescer por um parágrafo bem-intencionado, e `/home/ondokai/Projects/isometric-maker/scripts/check-docs.sh` passa a falhar se um desses termos reaparecer em `docs/`.

### O que é apagado

O usuário decidiu apagar, não arquivar. Isso **revoga**, para estes três arquivos e apenas para eles, a regra que este repositório escreveu para si em `docs/README.md`: *"Nunca editadas. Uma decisão revista gera ADR novo que substitui a anterior."*

Apagados:

- `docs/adr/0003-permadeath-total.md`
- `docs/adr/0004-combate-alvo-travado-zonas-oscilantes.md`
- `docs/adr/0007-fase1-vm-unica.md`
- `docs/02-design/combate-zonas-oscilantes.md`
- `docs/03-arquitetura/paper-doll-e-equipamento.md` — reescrito como `docs/02-personagem/guarda-roupa-e-silhueta.md`
- `.agents/skills/enforcing-server-authority/` e sua eval

As três ADRs apagadas não têm sucessora: o escopo delas deixou de existir, e escrever uma ADR para dizer "isto não se aplica mais" seria registrar a ausência de uma decisão. O registro de que existiram é este documento e o histórico do git.

**Não são apagados** `.agents/skills/project-analysis.md` e `.agents/skills/skill-map.md`, embora descrevam o projeto antigo. O `project-router` os declara parte da trilha de auditoria e proíbe apagá-los, e `meta-skill-consolidate` e `meta-skill-evolution` os referenciam. Recebem, no topo, um aviso de que descrevem o produto anterior a esta ADR.

### O que fica, e por quê

As ADRs **0001** (PixiJS em vez de Cocos) e **0005** (`low top-down`, 8 direções) **não são apagadas**. Não são documentos de MMORPG: são decisões técnicas cuja *justificativa* era MMORPG. A comparação entre Cocos, Godot e Bevy da 0001 é a entrada da sucessora — apagá-la deixaria a ADR nova sem contra o quê argumentar. São substituídas pelas 0014 e 0015, e nenhum byte dentro delas é alterado.

Ficam vigentes sem alteração: **0002** (cliente REST sobre o spec vendorizado), **0006** (`mode='template'`), **0008** (idioma por eixo), **0009** (conhecimento do PixiJS vendorizado).

### O mecanismo de supersessão

Este repositório tinha a convenção de nunca editar uma ADR, mas nenhum mecanismo para expressar que uma decisão foi substituída. A partir daqui:

1. A ADR nova declara o que substitui, em uma linha logo abaixo do Status:

   ```markdown
   **Status:** aceita · **Data:** 2026-07-30
   **Substitui:** ADR 0001
   ```

2. A tabela de ADRs em `docs/README.md` ganha coluna `Situação`, com vocabulário fechado: `vigente`, `substituída por 00XX`, `apagada — escopo removido pela 0010`.

O mecanismo é **unidirecional de propósito**: o arquivo novo ganha um campo, o arquivo antigo nunca é tocado. Isso mantém verdadeira a afirmação de data que cada ADR faz sobre si mesma. Marcar retroativamente `**Status:** substituída` em um arquivo datado de 2026-07-29 falsificaria o registro — que é exatamente o que a regra de não-editar protege.

## Alternativas consideradas

**Arquivar em `docs/99-arquivo/` em vez de apagar.** Preserva o raciocínio e não quebra citação nenhuma. Rejeitada por decisão do usuário: um editor não ganha nada carregando o desenho de um jogo que não vai existir, e o git já é o arquivo.

**Manter o MMORPG como produto secundário — o editor construiria o jogo.** Rejeitada porque as duas coisas competem por cada decisão de arquitetura. O servidor autoritativo, que é a espinha do jogo, é peso morto no editor; e o editor de cena, que é o produto aqui, era explicitamente descartado como irrelevante pela ADR 0001.

**Repositório novo, deixando este como está.** Rejeitada porque as duas ferramentas, os dois specs vendorizados e as trinta skills são o ativo — copiá-los para outro repositório é o mesmo trabalho sem o histórico.

## Consequências

- **A biblioteca de skills encolhe e muda de moldura.** `enforcing-server-authority` é retirada sem sucessora. Dez skills de PixiJS vieram escritas contra um jogo com tick autoritativo e alvo travado; `handling-pixi-input`, `bootstrapping-pixi-app` e `interpolating-pixi-state` invertem de premissa — num editor o clique **é** a decisão, e não um pedido ao servidor.
- **Custo de execução conhecido e alto:** apagar esses arquivos quebra cerca de 36 citações `arquivo:linha@hash` na biblioteca de skills. Arquivo citado ausente é **erro** no `lint-skills.mjs`; hash mudado é apenas **aviso**. Docs e skills precisam se mover no mesmo commit, e a varredura das citações que apenas mudaram de conteúdo é manual — o verificador não vai apontá-las.
- **O `AGENTS.md` perde a seção "Servidor autoritativo não é negociável"** e ganha "O que este projeto não é" no lugar.
- **A regra de custo é flexibilizada em outra ADR** (0012), mas a idempotência não. O cache continua sendo lei; o guard vira conselho.
- **O índice de documentação encolhe de 57 entradas prometidas para 22 arquivos que existem.** A coluna `Estado` com valor `pendente` desaparece: doc que não existe não é listada.

## Referências

- `/home/ondokai/Projects/isometric-maker/docs/README.md` — o índice, e a regra de supersessão que esta ADR altera
- `/home/ondokai/Projects/isometric-maker/docs/00-produto/visao.md` — o escopo do produto e o que ele não é
- `/home/ondokai/Projects/isometric-maker/.agents/skills/scripts/lib.mjs` — a diferença entre citação com erro e citação obsoleta

**Não verificado:** o significado exato do campo `isometric` nos endpoints de personagem — ver ADR 0015. A decisão de pivô não depende dele, mas o custo da primeira geração sim.

**Última atualização:** 2026-07-30
