# ADR 0004 — Combate travado no alvo com zonas oscilantes

> **Quick Start (TL;DR)**
>
> Clique para engajar; a chance por zona do corpo oscila ao vivo; teclas `1`–`4` trocam a zona visada. Sem mira no mouse, sem hitbox geométrica.

**Status:** aceita · **Data:** 2026-07-29

## Contexto

O jogo quer acerto na cabeça como morte instantânea. A documentação de rede da Valve avisa que hit detection compensada **não é pixel-perfect** e tem limites de precisão ligados ao tick rate e à velocidade dos objetos. Combinar imprecisão inerente com morte permanente e irreversível é a pior mistura possível.

## Decisão

Engajamento travado por clique. Chance por zona (cabeça, torso, braços, pernas) oscilando ao vivo como **função determinística do tick** e do estado do engajamento. Zona visada escolhida por tecla. Multiplicador por ângulo relativo por cima: frente `1.0×`, flanco `1.5×`, costas `2.5×`.

## Alternativas consideradas

- **Mira no mouse com zonas de altura** — máxima sensação de perícia, mas cria superfície de aimbot e depende de resolução geométrica precisa que a rede não entrega.
- **Grid por tile estilo Tibia** — o mais barato e justo, mas descartado por ser menos condizente com a ambição de realismo.

## Consequências

- **Imune a aimbot** e independente da qualidade da conexão para acertar.
- Banda quase zero durante o engajamento: o cliente computa a curva, o servidor manda seed e parâmetros uma vez.
- **O combate degrada menos que o resto sob rede ruim** — se o transporte engasgar, a tabela continua correta porque está sendo calculada localmente.
- **Custo aceito:** determinismo público é predizível, então um bot poderia snipar o pico. Mitigado por commit atrasado, custo de troca de zona, commit-reveal e detecção estatística. A vantagem residual é ~1–2% e fica instrumentada por um teste de CI, não eliminada.
- **Risco aberto:** o commit atrasado reduz agência de propósito e pode não ser divertido. Exige protótipo de feel antes de escrever servidor.

## Referências

- [`docs/02-design/combate-zonas-oscilantes.md`](../02-design/combate-zonas-oscilantes.md)
- [Source Multiplayer Networking](https://developer.valvesoftware.com/wiki/Source_Multiplayer_Networking)

**Última atualização:** 2026-07-29
