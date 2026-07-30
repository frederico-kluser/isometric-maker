# ADR 0003 — Permadeath total, sem exceção e sem restauração

> **Quick Start (TL;DR)**
>
> A morte apaga o personagem, as perícias, o inventário e o banco. Nada sobrevive. **Nunca restaurar personagem nem item**, nem por bug.

**Status:** aceita · **Data:** 2026-07-29

## Contexto

Permadeath total é o maior fator de churn conhecido em MMO, e historicamente nenhum jogo de permadeath integral sustentou base grande. Isso foi apresentado explicitamente ao usuário junto com três alternativas mais brandas (banco da conta sobrevive, ressurreição por item raro, permadeath só nas zonas full PvP). Ele escolheu a total, ciente do risco.

## Decisão

Morte apaga tudo do personagem. A conta mantém apenas o login.

E a regra que dá sentido à primeira: **nenhuma restauração, nunca.** Nem por bug do servidor, nem por queda de rede, nem por decisão de suporte. No instante em que a morte se torna negociável, a promessa deixa de ser verdade e a pressão para abrir exceções fica ilimitada.

## Consequências

- Requisito de design derivado, que vai no GDD: **encurtar radicalmente o tempo até voltar a ser relevante** — personagem novo competitivo em minutos, não semanas. É a única mitigação que não viola a regra.
- Requisito de arquitetura: como todo bug vira perda permanente, o sistema falha **a favor do jogador**. Erro de banco não mata; a morte só é real quando a transação commita.
- Exige auditoria de morte com replay determinístico guardado por 30 dias, para que qualquer disputa seja resolvível por evidência em vez de por confiança.
- Exige **um personagem vivo por conta**. Sem isso, um alt mula guarda o equipamento e a morte deixa de custar.

## Referências

- [`docs/02-design/permadeath-e-full-loot.md`](../02-design/permadeath-e-full-loot.md)

**Última atualização:** 2026-07-29
