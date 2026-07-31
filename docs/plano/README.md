# Ledger de incerteza — o que está em aberto, por quê, e com que evidência se fecha

> **Quick Start (TL;DR)**
>
> Este arquivo explica o ledger de incerteza do plano de execução. O ledger é um array JSON em
> `/home/ondokai/Projects/isometric-maker/docs/plano/ledger.json`. Cada item registra uma pergunta
> que o plano não respondeu. Itens abertos exigem uma decisão provisória; itens fechados exigem
> evidência anexada. O validador roda verde com o array vazio — a ferramenta não pode estrear no dia
> em que for usada de verdade.
>
> ```bash
> cat /home/ondokai/Projects/isometric-maker/docs/plano/ledger.json
> node /home/ondokai/Projects/isometric-maker/scripts/gate.sh  # o validador do ledger roda aqui
> ```

## O que é o ledger

O ledger é a lista das perguntas que este plano de execução não respondeu. Ele existe porque planos
são escritos antes de as ondas anteriores rodarem, e cada onda pode invalidar premissas das ondas
seguintes. Em vez de fingir que o plano prevê tudo, registramos o que está em aberto, decidimos
provisoriamente, e fechamos com evidência quando a resposta aparece.

O ledger é um **array JSON**, um item por pergunta. Ele fica em
`/home/ondokai/Projects/isometric-maker/docs/plano/ledger.json`.

Cada card do plano tem uma **faixa de ids** reservada (ex: `F0-01` reserva `AB-100..AB-109`). Isso
evita que duas worktrees concorrentes escrevam no mesmo id. Os itens são escritos em
`docs/plano/inbox/<card>.json`, nunca no arquivo principal — o orquestrador consolida depois do
merge.

## Como abrir um item

Quando uma pergunta aparece durante a execução de um card e o card não a responde, **abra um item**.
O item aberto registra o que você não sabe, o que você assumiu para poder continuar, e como alguém
vai saber que a pergunta foi respondida.

O arquivo `docs/plano/inbox/<card>.json` contém um array. Adicione um objeto com estes cinco
campos:

```json
{
  "id": "AB-105",
  "por_que_aberto": "O spec vendorizado não documenta o campo 'tile_feature' do endpoint create-tiles-pro — os valores aceitos são inferidos dos exemplos.",
  "decisao_provisoria": "Usar os valores que aparecem nos exemplos: 'building', 'ground', 'water'. Se falhar na submissão, ler a mensagem de erro.",
  "verificacao": "A primeira chamada a create-tiles-pro com tile_feature retorna 200 ou uma mensagem de erro que lista os valores válidos.",
  "evidencia": ""
}
```

| Campo | Significado |
| --- | --- |
| `id` | Identificador único, dentro da faixa do card. Ex: `AB-105`. |
| `por_que_aberto` | Por que isso não foi decidido? O que falta? |
| `decisao_provisoria` | O que você assumiu para poder continuar. |
| `verificacao` | Como alguém vai saber que este item foi respondido? |
| `evidencia` | **Vazio.** Item aberto não tem evidência. |

Marque o ponto exato no código onde a decisão provisória foi tomada com um comentário:

```ts
// ABERTO AB-105: assumindo que tile_feature aceita 'building', 'ground' e 'water'
```

Isso permite que um `grep ABERTO` ache todas as decisões provisórias no código.

## Como fechar um item

Quando a resposta chega, o item **fecha**:

1. Preencha `evidencia` com uma **forma verificável** (veja abaixo).
2. Adicione `data_resolucao` em ISO 8601 (`2026-08-03`).
3. Remova o comentário `// ABERTO` do código (ou marque-o como `// FECHADO AB-nnn`).

### Formas de evidência aceitas

| Formato | Exemplo |
| --- | --- |
| `arquivo:linha` | `tools/pixellab-pipeline/src/cost.ts:42` — a resposta está nessa linha |
| `saída de comando:` seguido da saída | `saída de comando: node src/cli.ts doctor` |
| `ADR NNNN` | `ADR 0018` — uma decisão de arquitetura posterior respondeu |
| `resposta de NOME em DATA` | `resposta de Ondokai em 2026-08-03` — uma pessoa respondeu |

### Lista negra de evidências

Estas strings **nunca** são aceitas como evidência, e o validador rejeita qualquer item que as
contenha:

- `ok`
- `confirmado`
- `conforme combinado`
- `ok!`
- `feito`
- `resolvido`

A frase que justifica a lista negra: **item marcado confirmado sem evidência anexada é pior que
item aberto, porque para de ser reperguntado e vira premissa invisível.** Um item aberto todo mundo
vê; um item "confirmado" sem lastro ninguém questiona, e a premissa errada viaja ondas abaixo sem
que nada a detenha.

### Exemplo de item fechado

```json
{
  "id": "AB-105",
  "por_que_aberto": "O spec vendorizado não documenta o campo 'tile_feature' do endpoint create-tiles-pro — os valores aceitos são inferidos dos exemplos.",
  "decisao_provisoria": "Usar os valores que aparecem nos exemplos: 'building', 'ground', 'water'. Se falhar na submissão, ler a mensagem de erro.",
  "verificacao": "A primeira chamada a create-tiles-pro com tile_feature retorna 200 ou uma mensagem de erro que lista os valores válidos.",
  "evidencia": "ADR 0018",
  "data_resolucao": "2026-08-03"
}
```

## O validador

O validador do ledger roda **dentro do `gate.sh`**, como etapa nomeada. Ele confere:

- Item **ABERTO**: `por_que_aberto`, `decisao_provisoria` e `verificacao` não podem estar vazios.
  `evidencia` **tem** de estar vazia.
- Item **FECHADO**: `evidencia` tem de casar com um dos formatos verificáveis. `data_resolucao` tem
  de estar em ISO. A evidência não pode estar na lista negra.
- O ledger em si tem de ser um array JSON válido.

O validador roda **verde com o array vazio**. Esse é o ponto: a ferramenta existe e funciona desde o
primeiro dia, para que o dia de fechar o primeiro item não seja o dia de estrear a ferramenta.

## Referências

- `/home/ondokai/Projects/isometric-maker/PLANO-DE-EXECUCAO.md` — seção 2.2, faixas de id do ledger
- `/home/ondokai/Projects/isometric-maker/scripts/gate.sh` — o validador do ledger roda aqui
- `/home/ondokai/Projects/isometric-maker/scripts/validate-plan.mjs` — o validador do grafo do plano

**Última atualização:** 2026-07-30
