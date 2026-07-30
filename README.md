# Ferro e Cinzas

MMORPG 2D pixel art medieval **hardcore**. Você morre, perde o personagem. Não tem volta, não tem GM, não tem pena.

> **Título de trabalho.** O nome vive em `docs/00-visao-geral/conceito.md` e no nome da pasta.

## Quick Start (TL;DR)

| Quero… | Vá para |
|---|---|
| Entender o jogo em 5 minutos | [`docs/00-visao-geral/conceito.md`](docs/00-visao-geral/conceito.md) |
| Usar o PixelLab (a ferramenta de arte de tudo) | [`docs/01-pixellab/README.md`](docs/01-pixellab/README.md) |
| Gerar assets agora | [`ferramentas/pixellab-pipeline/`](ferramentas/pixellab-pipeline/) |
| Saber por que as decisões foram tomadas | [`docs/adr/`](docs/adr/) |
| Ver a documentação inteira | [`docs/README.md`](docs/README.md) |

```bash
# pipeline de assets
cd ferramentas/pixellab-pipeline
npm install
export PIXELLAB_SECRET="seu-token"   # pixellab.ai/account
npm run cli -- balance               # confirma autenticação e saldo
npm run cli -- plan                  # estima custo do catálogo SEM gastar
npm run cli -- generate --limit 1    # gera um asset de verdade
```

## O que este jogo é

Cinco regras que definem tudo o mais:

1. **Morte é definitiva.** O personagem é apagado. Skills, banco, inventário, tudo.
2. **Full loot.** O que você carregava fica no seu corpo, para quem chegar primeiro.
3. **As melhores zonas são full PvP.** Risco e recompensa andam juntos, sempre.
4. **O equipamento define a classe.** Não existe "escolher mago". Existe vestir de mago.
5. **Só jogadores criam itens.** O NPC lojista é um balcão de consignação, não uma fábrica.

E uma consequência que a maioria dos jogos evita: **não existe GM**. Toda moderação é automática ou não existe. Isso é requisito de arquitetura, não política de comunidade.

## Estado atual

| Parte | Estado |
|---|---|
| Documentação do PixelLab | em construção |
| Pipeline de assets | em construção |
| GDD | em construção |
| Arquitetura de servidor | em construção |
| Cliente / servidor / gameplay | não começou |

## Convenções

- **Documentação e todo texto de jogo: português do Brasil.**
- **Código, identificadores, nomes de arquivo de código e mensagens de commit: inglês.**
- Todo documento abre com um Quick Start (TL;DR) e fecha com `## Referências`.
- Fatos sobre APIs externas são checados contra fonte primária e **datados**. Nada de memória.

## Referências

- [`docs/README.md`](docs/README.md) — índice completo
- [`AGENTS.md`](AGENTS.md) — instruções para agentes de código
