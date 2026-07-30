# ADR 0001 — PixiJS 8 no cliente, em vez de Cocos Creator

> **Quick Start (TL;DR)**
>
> Cliente é TypeScript + PixiJS 8 + Vite, rodando no navegador. Isso **divergiu** da pesquisa própria do usuário, que recomendava Cocos Creator 3.8.

**Status:** aceita · **Data:** 2026-07-29

## Contexto

Os documentos em `/home/ondokai/Projects/tech-docs/games/{1,2,4,6}.md` recomendam Cocos Creator 3.8 LTS + TypeScript + PixelLab. Nenhum projeto na máquina usa Godot, Unity, Cocos, Phaser ou PixiJS — é greenfield de verdade.

## Decisão

TypeScript + PixiJS 8 + Vite, no navegador. Servidor autoritativo em TypeScript, com pacote compartilhado de protocolo e regras.

## Alternativas consideradas

- **Cocos Creator 3.8** — traz editor de cena, tilemap e animação prontos. Rejeitado porque num MMO a lógica autoritativa vive no servidor e o mundo é montado a partir de dados que chegam por rede; o editor de cena rende pouco nesse desenho, e o servidor precisaria ser uma segunda stack.
- **Godot 4** — não está instalado na máquina, e servidor autoritativo em Godot é menos provado em escala.
- **Bevy/Rust** — zero projetos Rust no histórico do usuário (`Cargo.lock` contados: 0). Custo de aprendizado desproporcional.

## Consequências

- Uma linguagem só entre cliente e servidor; regras de dano compartilhadas literalmente, o que é o que torna predição correta em vez de aproximada.
- Jogador entra por link, sem instalar nada.
- **Custo:** PixiJS é apenas renderer. Cena, tilemap, colisão, câmera e UI são nossos. O plano orça isso.
- Cliente é código público e inspecionável — o que reforça, e não cria, a exigência de servidor autoritativo.

## Referências

- `/home/ondokai/Projects/tech-docs/games/1.md`, `2.md`, `4.md`, `6.md` — a recomendação divergente

**Última atualização:** 2026-07-29
