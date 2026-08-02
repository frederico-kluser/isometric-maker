# ADR 0036 — Física de marchas, agachar e gravidade

> **Quick Start (TL;DR)**
>
> O personagem virou jogável no `packages/iso-core`: **correr é o default**,
> Shift anda (fator 0,5), Control agacha (fator 0,35) e agachado **não pula**.
> A gravidade resolve contra o mapa (`fallSpeed` de 12 níveis/s, salto limitado
> a 1 nível) e o degrau acontece **na travessia da aresta** — onde o passo é
> validado é onde o personagem termina, então a gravidade não desfaz a subida.
> `stepWithMap` acopia dt num acumulador de passo fixo: o replay é
> determinístico.
>
> ```bash
> cd /home/ondokai/Projects/isometric-maker/packages/iso-core && node --test src/movement.test.ts
> cd /home/ondokai/Projects/isometric-maker/packages/iso-core && node --test src/simulate.test.ts
> cd /home/ondokai/Projects/isometric-maker/packages/iso-core && node --test src/step-gravity-agreement.test.ts
> ```

**Status:** aceita · **Data:** 2026-08-02

## Contexto

O iso-core tinha movimento e colisão de blocos, mas nenhum personagem
jogável. A tela do mapa desenhava o personagem só estaticamente. A primeira
tentativa de gravidade + degrau falhou de um jeito sutil: o passo era
validado na célula **vizinha** e o `z` subia na hora; a gravidade então
reavaliava o suporte na célula **atual**, onde aquele `z` é insuportado por
construção, e desfazia a subida. Sintoma medido: 7 de 8 posições de degrau
deixaram de ser escaláveis, e **se um degrau era escalável dependia da fase do
acumulador de queda**, não da geometria.

A correção e a física nova entraram nos commits `7650c19` e `43abafd`,
fechando os 473 testes do iso-core.

## Decisão

**1. Marchas com default definido.** `Gait = 'run' | 'walk' | 'crouch'`. Sem
Shift, o personagem **corre** (a velocidade base); Shift (`input.walk`) anda a
`walkFactor` 0,5; Control (`input.crouch`) agacha a `crouchFactor` 0,35.
`resolveGait` prioriza agachar sobre andar.

**2. Agachado não pula.** `input.jump` é ignorado enquanto o personagem está
agachado — a postura baixa não tem salto.

**3. A gravidade resolve contra o mapa.** A queda (`fallSpeed` de 12 níveis/s)
para quando o personagem assenta numa célula suportada; o salto é limitado a
`MAX_JUMP_RISE = 1` — pedir mais não sobe mais.

**4. O degrau acontece na travessia da aresta.** `stepZOnCross` valida o
passo **na célula em que o personagem vai terminar**: a gravidade reavalia o
suporte ali e encontra o `z` suportado, então não desfaz a subida. O que a
fase do acumulador decidia passa a ser decidido pela geometria.

**5. Passo fixo com acumulador.** `stepWithMap(state, input, dt, config, map)`
é a porta por quadro; ela acopia `dt` em `state.accumulator` e executa
`floor(total / fixedDt)` passos de `fixedStepWithMap`, guardando o resto como
alfa de interpolação. Mesma entrada + mesma sequência de `dt` → mesmo
caminho, independente de quando os quadros chegam.

**6. Estado observável.** `MovementState` expõe `gait`, `crouching`,
`falling`, `jump` e `blocked` — o que a tela precisa para escolher animação e
feedback.

## Alternativas descartadas

**Degrau validado na célula vizinha, `z` subido na hora.** Era a primeira
versão; a gravidade desfazia a subida na reavaliação de suporte e a
escalabilidade dependia da fase do acumulador. Rejeitado por medição.

**Avançar com `dt` cru, sem passo fixo.** O resultado dependeria do timing
dos quadros, e o replay não seria determinístico. O acumulador garante que o
estado só muda em passos discretos de `fixedDt`.

**Agachar com salto permitido.** A postura baixa é o estado "baixo perfil";
pular dela contradiz a pose e a semântica do controle.

## Consequências

- **Replay determinístico.** Mesma entrada e mesma sequência de `dt` produzem
  o mesmo caminho; a fase do acumulador deixou de influenciar a escalabilidade
  de degraus.
- **A cena redesenha por mudança de estado, não por quadro** (ADR 0010). O
  ticker do modo de teste da tela do mapa é a exceção — `app.ticker.add`
  chamando `stepWithMap` — e tem que ser removido ao sair do modo. A fiação
  ainda não está feita; a física está.
- **Não existe animação de agachar.** A biblioteca de templates da PixelLab
  tem 10 templates e nenhum é andar/correr/pular/agachar; as poses embutidas
  nascem como `action` de texto livre, e o fallback cai em `parado`. Uma pose
  de agachar de verdade é geração futura com `kind: 'action'`.
- **Degrau diagonal não sobe.** `canStepUp` exige adjacência cardinal —
  comportamento herdado, inalterado por esta decisão; implementar exige
  decisão nova.
- **O runtime continua sem gravidade.** `tools/runtime/src/main.ts` chama
  `step` com 4 argumentos, sem mapa; o personagem do runtime segue sem
  colisão. Não é defeito — é a fronteira que `check-runtime-boundary` zela.

## Referências

- [`ADR 0010`](0010-pivo-para-editor-isometrico.md) — editor local; cena desenhada por mudança de estado
- `/home/ondokai/Projects/isometric-maker/packages/iso-core/src/simulate.ts` — `stepWithMap`, `fixedStepWithMap` e o acumulador
- `/home/ondokai/Projects/isometric-maker/packages/iso-core/src/movement.ts` — gaits, fatores e `MAX_JUMP_RISE`
- `/home/ondokai/Projects/isometric-maker/packages/iso-core/src/step-up.ts` — `stepZOnCross`, o degrau na travessia
- `/home/ondokai/Projects/isometric-maker/tools/character-builder/src/map/collision-map.ts` — a ponte `MapData` → `CollisionMap`
- `/home/ondokai/Projects/isometric-maker/tools/character-builder/src/map/actor.ts` — direção, entrada e escolha de animação

**Última atualização:** 2026-08-02
