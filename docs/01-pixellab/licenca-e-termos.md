# Licença e termos de uso

> **Quick Start (TL;DR)**
>
> Você é dono dos assets gerados e pode usá-los em jogo comercial pago. A única proibição é **treinar outros modelos** com as saídas. Mas: **não há indenização de IP**, o ToS te vincula também à **Open RAIL-M**, e o foro é a **Suécia**.

## O que o contrato diz

Termos verificados por download direto de `pixellab.ai/termsofservice` em **2026-07-29**. O documento declara `Last Updated: 2025-11-23`.

§1.3, verbatim:

> *"You own the copyrights to your creations, permitting usage for both commercial and non-commercial purposes with no need for permission."*

§3.3, verbatim:

> *"You retain ownership of any content you create using PixelLab. You are free to use, modify, and distribute the outputs from our tools for any purpose, except for training other models without our explicit permission. However, you bear full legal responsibility for ensuring that the content you create complies with all applicable laws and does not infringe on the rights of any third parties."*

Corroboração independente: o bundle da interface de preços traz *"Use generations commercially in your games and other projects"*, e a linha "License / Use generated images commercially" aparece em **todos** os tiers, inclusive no Free trial. Jogo comercial é uso explicitamente sancionado.

Nota de precisão terminológica: o contrato **reconhece** a titularidade do usuário, não *cede* copyright. A diferença importa se algum dia você precisar defender a propriedade.

## As quatro ressalvas que precisam andar junto

Nenhuma refuta o acima. Todas mudam o risco.

### 1. Não há indenização de IP

§5.1 entrega o serviço *"as is"* e §6.1 limita responsabilidade. Isso é diferente de Adobe Firefly ou Shutterstock, que oferecem indenização contratual. **Se um terceiro alegar que um asset gerado infringe direito dele, o risco é integralmente seu** — e §3.3 diz isso com todas as letras.

Para um jogo comercial isso é um risco real, não teórico. Mitigação prática: manter registro de procedência de cada asset (prompt, seed, parâmetros, data) para poder demonstrar geração independente. O nosso pipeline grava isso no lockfile como `requestSnapshot`.

### 2. Open RAIL-M se propaga

§4.1 vincula o usuário também à licença **Open RAIL-M**. As restrições de uso dessa licença **se propagam para distribuição downstream**. Vale ler o texto da RAIL-M antes de assumir que "sou dono" encerra o assunto — ela impõe restrições de finalidade que o copyright não impõe.

**Não verificado:** exatamente quais cláusulas da RAIL-M se aplicam ao output em vez de ao modelo, e como isso interage com distribuição em loja de jogos.

### 3. Encerramento de conta é silencioso sobre os assets

§8.1 permite encerrar a conta *"at any time, without prior notice or liability, for any reason"*. O contrato é **silencioso** sobre a sobrevivência dos direitos sobre assets já gerados após o encerramento.

Consequência operacional: **nunca dependa da PixelLab como repositório dos seus assets.** Baixe e versione tudo localmente. É por isso que o pipeline mantém cache em disco indexado por hash e trata recurso remoto apenas como conveniência.

### 4. Foro é a Suécia

§7.1 define lei e foro suecos. O Código de Defesa do Consumidor brasileiro não é o caminho padrão de disputa. §2.1 ainda reserva alteração unilateral de limites e preços.

## Uso programático

§2.2, verbatim:

> *"Programmatic usage is only allowed through our official API (api.pixellab.ai). Our API is designed for vibe coding and in-game live asset creation. If you want to use the API for other purposes (like building your own service or reselling), reach out to us at hello@pixellab.ai"*

Enquadramento correto, e é importante não exagerar em nenhuma direção:

- **Permitido:** pipeline interno gerando centenas de sprites para o jogo comercial do próprio time. É literalmente o uso pretendido — a página da API vende *"procedural generation, live asset creation, and dynamic game content"*.
- **Precisa de autorização:** revender a capacidade de geração, ou expor a geração como serviço próprio.
- **Não permitido:** dirigir a aplicação web por script em vez de usar a API. *(Inferência defensável — as palavras "scraping" e "web app" não aparecem no ToS.)*

A restrição incide sobre **produtizar**, não sobre volume.

## Treinar modelo é proibido

§1.2 veda usar as saídas para treinar modelos sem permissão escrita. Se algum dia surgir a ideia de treinar um upscaler local ou um gerador com os sprites gerados, está vedado. Vale registrar em ADR para não ser redescoberto por acidente.

## Referências

- [`https://www.pixellab.ai/termsofservice`](https://www.pixellab.ai/termsofservice) — `Last Updated: 2025-11-23`, conferido por download em 2026-07-29
- [`https://www.pixellab.ai/pricing`](https://www.pixellab.ai/pricing) — a linha de licença em todos os tiers

**Não verificado:** o texto integral da Open RAIL-M aplicável e o alcance das suas restrições sobre output; se há política de retenção de asset após encerramento de conta.

**Última atualização:** 2026-07-29
