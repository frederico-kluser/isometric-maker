# ADR 0016 — UI do editor em pt-BR, com strings centralizadas desde o primeiro commit

> **Quick Start (TL;DR)**
>
> A interface do editor é em português do Brasil. Toda string visível vive num único módulo, como objeto congelado com **acesso por propriedade direta** — não uma função `t()`. Chave que não existe vira erro de compilação, e traduzir depois é trocar um módulo.
>
> ```ts
> import { S } from './i18n/pt-BR.ts';
> botao.textContent = S.gerarOitoDirecoes;   // erro de compilação se a chave não existir
> ```

**Status:** aceita · **Data:** 2026-07-30

## Contexto

A [ADR 0008](0008-idioma-docs-ptbr-codigo-en.md) divide idioma por eixo: documentação e todo texto que **o jogador** lê em português; código, identificadores e commits em inglês.

A [ADR 0010](0010-pivo-para-editor-isometrico.md) trocou o jogador por um usuário de ferramenta. O eixo continua fazendo sentido — só muda quem é o leitor —, mas a pergunta que ele não responde é: um construtor de jogos tem público naturalmente global, e o repositório passou a se chamar `isometric-maker`, em inglês. Vale escrever a interface em inglês desde já?

E há uma pergunta separada, que é a que custa caro se ficar para depois: onde as strings moram.

Internacionalizar um projeto que espalhou literais pelo código é caça a literal — trabalho manual, incompleto por construção, e que só termina quando alguém encontra a última mensagem de erro esquecida dentro de um `catch`. Centralizar desde o primeiro commit custa quase nada.

## Decisão

**A interface é em português do Brasil**, mantendo o eixo da ADR 0008 com o leitor atualizado: "todo texto que o usuário do editor lê" ocupa o lugar de "todo texto que o jogador lê". O texto do jogo exportado pelo editor também é pt-BR, quando o projeto define algum.

**Todas as strings visíveis ficam em `src/i18n/pt-BR.ts`**, num objeto congelado, acessado por propriedade direta:

```ts
export const S = {
  gerarOitoDirecoes: 'Gerar 8 direções',
  esqueletoAprovado: 'Esqueleto aprovado',
  custoDaSessao: 'Sessão',
  erroDimensaoReferencia: 'A referência precisa ter exatamente as dimensões do personagem.',
} as const;
```

**Não é uma função `t('chave')`.** A razão é o compilador. Os dois `tsconfig.json` do repositório ligam `noUncheckedIndexedAccess`, então indexar um objeto por string devolve `string | undefined` e obriga a tratar `undefined` em todo lugar — ou, pior, convida a um `!` que apaga a checagem. Acesso por propriedade é verificado em tempo de compilação, custa zero em tempo de execução, e **chave inexistente é erro de compilação, não string vazia na tela**.

Internacionalizar depois é escrever `en.ts` com o mesmo tipo e trocar o módulo por alias de build. O `as const` garante que qualquer tradução com chave faltando não compila.

## Alternativas consideradas

**Interface em inglês.** O argumento é real: o produto é uma ferramenta, o repositório tem nome em inglês, e público de gamedev lê inglês. Rejeitada por dois motivos. O usuário desta ferramenta trabalha em português — é ele quem vai usá-la todos os dias, e otimizar a ergonomia dele para um público hipotético é inverter a prioridade. E a decisão não é irreversível: com as strings centralizadas, virar o idioma padrão é trocar um import.

**Uma biblioteca de i18n pronta.** Rejeitada porque o projeto tem uma única localidade, nenhum plural complexo e nenhuma formatação de data sensível a região. Uma dependência para resolver um problema que ainda não existe é o oposto da convenção 12.

**Deixar as strings inline e centralizar quando houver necessidade real.** Rejeitada porque "quando houver necessidade" é exatamente o momento em que o custo já foi pago.

## Consequências

- **Toda string visível passa pelo módulo, inclusive mensagem de erro.** Erro é o texto que mais escapa de centralização e o que mais precisa dela — é o que o usuário lê no pior momento.
- **A regra vale só para texto de interface.** Log de servidor, nome de comando de CLI, chave de JSON e mensagem de commit continuam em inglês pela ADR 0008. A linha divisória é *quem lê*: usuário na tela, ou desenvolvedor no terminal.
- **Existe atrito de escrita:** acrescentar um botão passa a exigir duas edições, o módulo e o componente. É o preço, e é pequeno.
- **O linter não verifica isso.** Não há checagem automática que impeça um literal solto na UI, e o repositório não tem linter nem CI. Fica como convenção sustentada por revisão — declarado aqui para não parecer garantia.

## Referências

- [`ADR 0008`](0008-idioma-docs-ptbr-codigo-en.md) — o eixo de idioma que esta ADR aplica ao editor
- [`ADR 0010`](0010-pivo-para-editor-isometrico.md) — a troca de leitor, de jogador para usuário de ferramenta
- `/home/ondokai/Projects/isometric-maker/tools/pixellab-pipeline/tsconfig.json` — `noUncheckedIndexedAccess`, que é o motivo de o acesso ser por propriedade

**Última atualização:** 2026-07-30
