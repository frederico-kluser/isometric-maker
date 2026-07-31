# Handoff: F0-07 — Strings pt-BR centralizadas

**Card:** F0-07 · **Onda:** W2 · **Data:** 2026-07-30

## Arquivos produzidos

| Arquivo | Propósito |
| --- | --- |
| `tools/character-builder/src/strings.ts` | Módulo central de strings da UI. Objeto `S` `as const` + funções parametrizadas. |
| `tools/character-builder/src/strings.test.ts` | Teste de integridade: percorre `S` e falha se alguma string for vazia. |

## API pública

### `S` (objeto `as const`)

Strings estáticas organizadas em 4 áreas:

| Área | Chaves | Descrição |
| --- | --- | --- |
| `S.comum` | `gerar`, `gerando`, `nome`, `frames`, `fps`, `acao`, `ocioso` | Strings transversais a várias seções |
| `S.personagem` | `titulo`, `modeloBase`, `semIdRemoto`, `gerarBase`, `gereBasePrimeiro`, `arteReferencia`, `posesOitoDirecoes`, `cadastrarNovaPose`, `guardaRoupaEquipamento`, `pose`, `peca`, `cadastrarPeca`, `cadastrarPose`, `slot`, `edicaoPrompt`, `manterPaleta`, `comoGerar`, `kindTemplate`, `kindTexto`, `kindEsqueleto`, `referenciaAnexada`, `arrasteReferencia`, `placeholderPeca`, `placeholderPose`, `notaPoseForm`, `notaReferencia` | Strings específicas do domínio de personagem |
| `S.custo` | `semToken` | Relacionadas a custo/token |
| `S.erro` | `prefixo`, `leituraArquivo` | Mensagens de erro |

Uso: `S.comum.gerar`, `S.personagem.modeloBase`, etc.

### Funções parametrizadas (não são `t(chave)` genérica)

| Função | Assinatura | Exemplo de saída |
| --- | --- | --- |
| `idRemoto` | `(id: string) => string` | `"id remoto abcd1234…"` |
| `geracoesEmAndamento` | `(n: number) => string` | `"3 geração(ões) em andamento — 2 a 5 min cada"` |
| `silhuetaNaoServe` | `(silhouette: string) => string` | `"silhueta heavy — não serve neste corpo"` |
| `pecaSilhuetaIncompativel` | `(item: string, char: string) => string` | `"peça é heavy, personagem é light"` |
| `descricaoAtual` | `(desc: string) => string` | `"Descrição atual: \"um guerreiro…\"'"` |
| `notaGuardaRoupa` | `(silhouette: string) => string` | Parágrafo explicativo com silhueta interpolada |
| `notaEsqueleto` | `(labels: string) => string` | Parágrafo explicativo com keypoints interpolados |

### Teste

```bash
npx tsx tools/character-builder/src/strings.test.ts
```

Percorre `S` recursivamente e falha (`exit 1`) se qualquer valor-folha for string vazia.

## Decisões de design

1. **Objeto `as const`, não função `t()`.** Acesso por propriedade direta (`S.comum.gerar`) dá erro de compilação se a chave não existir. O `tsconfig.json` tem `noUncheckedIndexedAccess`, que tornaria `t('chave')` inseguro (retornaria `string | undefined`).

2. **Strings estáticas no objeto, strings parametrizadas como funções separadas.** `as const` não agrega valor para funções. Mantê-las separadas mantém o objeto limpo e o teste simples (só percorre valores `typeof string`).

3. **Chaves em inglês, valores em pt-BR.** Segue ADR 0008 e ADR 0016. As chaves são descritivas (`modeloBase`, `gereBasePrimeiro`) para que o código permaneça legível mesmo para quem não fala português.

4. **Placeholders de PROMPT em inglês mantidos como estão.** O campo `edicaoPrompt` tem o placeholder em inglês (`'wearing a rusted chainmail hauberk'`) porque o valor do campo é enviado diretamente à API do PixelLab. O comentário no código documenta isso. Os rótulos ao redor estão em pt-BR.

5. **Notas longas com interpolação são funções, não template strings no objeto.** `notaGuardaRoupa(silhouette)` e `notaEsqueleto(labels)` recebem os valores dinâmicos por parâmetro — o call site continua responsável por passar `char.silhouette` ou `SKELETON_LABELS.slice(0, 4).join(', ')`.

6. **Nenhuma edição em `main.ts`.** O card proíbe. A migração do `main.ts` para usar este módulo fica para uma task futura (provavelmente na onda W3, quando o editor for refatorado).

## Limitações conhecidas

- **O módulo não é importado por `main.ts` ainda.** O card F0-07 só cria o módulo e o teste; a migração dos call sites em `main.ts` é uma task separada. Até lá, as strings continuam duplicadas (literal inline + entrada no módulo).
- **O teste não é executado pelo `npm test`.** Não há script `test` no `package.json`. O teste é autônomo e roda com `npx tsx`.
- **Strings dos slots do guarda-roupa (`cabeca`, `torso`, etc.) não foram centralizadas.** Esses valores são identificadores de tipo (`WardrobeSlot`) usados tanto como valor do `<option>` quanto como label — são programáticos, não strings de UI.
- **As tags de kind de pose (`pose.kind`) são valores de enum do modelo e aparecem como tags visuais, mas não foram centralizadas.** São valores que vêm do servidor, não literais no frontend.

## O que as tasks descendentes precisam saber

- **Qualquer card que edite `main.ts`**: o módulo de strings já existe e deve ser usado. Importe `{ S, idRemoto, geracoesEmAndamento, ... }` de `./strings.ts` e troque os literais por referências.
- **Qualquer card que adicione strings novas**: acrescente em `strings.ts` na área correta ANTES de usar no componente.
- **O teste `strings.test.ts`** deve continuar passando (`exit 0`) após qualquer adição de string.
- **Internacionalizar depois é escrever `en.ts`** com o mesmo tipo e trocar o import — o `as const` garante que chave faltando na tradução é erro de compilação.
