# ADR 0026 — O giro da câmera é animado: posição interpolada, sprite nunca rotacionado

> **Quick Start (TL;DR)**
>
> Girar entre duas das quatro vistas passa a ser uma transição de 280 ms com suavização cúbica. O que interpola é a **posição** — as coordenadas de grid rotacionam por um ângulo contínuo e são projetadas pela fórmula de sempre. O **sprite nunca gira**: a face troca por cross-fade. Rotacionar pixel art por ângulo não múltiplo de 90° reamostra a imagem e transforma a arte paga em borrão.
>
> ```bash
> cd /home/ondokai/Projects/isometric-maker/packages/iso-core && node --test src/rotation-tween.test.ts
> ```

**Status:** aceita · **Data:** 2026-08-01

## Contexto

A [ADR 0021](0021-rotacao-de-camera-em-quatro-vistas.md) decidiu que a rotação é um parâmetro de vista, discreto, guardado como inteiro e avançado com `(rot + d) & 3`. A decisão continua certa e não muda aqui.

O que faltava é o intervalo entre uma vista e a seguinte. Trocar `rotation` de 0 para 1 num quadro faz o mapa inteiro saltar 90°, e um salto de 90° não se lê como giro: lê-se como corte de câmera, e quem estava editando perde de vista onde estava.

A pesquisa feita para esta tarefa procurou como jogos isométricos comerciais resolvem isso — cross-fade, tween de container, curva de suavização, duração típica, e o comportamento de Age of Empires, SimCity, Transport Tycoon e afins. **Nenhuma afirmação externa sobreviveu à verificação.** O ângulo voltou vazio: não há aqui confirmação nem desmentido de nada, apenas ausência de evidência. O que segue é derivado da geometria e de uma restrição dura.

## Decisão

**O giro é uma transição animada de 280 ms com suavização cúbica simétrica, em que só a posição é interpolada.**

A restrição dura é: **o sprite não pode ser rotacionado.** Pixel art rotacionada por ângulo que não seja múltiplo de 90° é reamostrada, e reamostrar destrói a grade de pixels — a arte pela qual se pagou vira borrão durante a transição inteira. Isso elimina a solução óbvia, que seria girar o container.

O que sobra, e o que se faz:

1. **A coordenada de grid rotaciona por um ângulo contínuo** e é projetada pela mesma fórmula das quatro vistas. `rotatePointContinuous(x, y, turn)` concorda exatamente com `rotatePoint` nos inteiros — há teste que varre as quatro vistas numa grade de 81 células.
2. **A face desenhada troca por cross-fade.** A vista de origem vai por baixo, opaca; a de destino por cima, com o alfa do progresso suavizado. Duas semitransparentes somadas deixariam o fundo aparecer através do bloco no meio do giro.
3. **A chave de profundidade é recalculada a cada quadro a partir da coordenada contínua.** Durante um giro de 90° dois blocos realmente trocam de profundidade; a chave contínua faz a troca acontecer no instante geometricamente certo, em vez de tudo de uma vez no começo ou no fim.
4. **O enquadramento é recalculado a cada quadro.** Sem isso o mapa descreve um arco e sai da tela no meio do giro, porque girar muda o sinal de `x − y`.
5. **O caminho é sempre o curto.** De 3 para 0 são `+1`, não `−3`. Meia-volta é ambígua por construção e desempata pelo horário, declarado para ser determinístico.

**A animação vive no ticker do PixiJS, não no React.** Reconciliar a árvore 60 vezes por segundo por causa de uma transição de 280 ms seria caro por um efeito visual. O React recebe o estado uma vez, quando o giro termina.

**Durante o giro não existe célula sob o cursor.** `screenToCell` usa `rotation` (discreta), nunca `turn`, e o preview some enquanto a câmera se move. Inventar uma célula a partir de uma rotação fracionária colocaria a peça em lugar aleatório.

## Consequências

- **280 ms e a curva cúbica são escolha deste projeto, sem respaldo externo verificado.** Estão numa constante nomeada (`ROTATION_DURATION_MS`) e a duração é parâmetro de `rotateTo`, então mudar de ideia é mudar um número.
- **Durante a transição há dois sprites por célula.** O pool absorve, mas o pico de sprites dobra enquanto o giro dura.
- **Blocos em modo `uniform` não mudam de desenho ao girar** — têm uma arte só nas quatro vistas, por decisão de custo ([ADR 0022](0022-blocos-do-mundo-isometricos.md)). O cross-fade continua correto e simplesmente não tem o que mostrar. Os cubos procedurais variam o desenho do material por vista, mantendo o tom de cada face: a luz é presa à câmera, e mudar o tom ao girar se leria como bug.
- **Girar durante um giro é ignorado.** Encadear tweens sobre o mesmo alvo faria a câmera passar do ponto e voltar.
- **A oclusão continua imperfeita e agora tem um instante a mais de exposição.** Uma cena acíclica de uma vista pode ser cíclica de outra, e o meio do giro é onde isso aparece. A restrição de sprite de célula única continua sendo o que segura o problema.

## Referências

- [`ADR 0021`](0021-rotacao-de-camera-em-quatro-vistas.md) — a rotação como parâmetro de vista, discreta; vigente
- [`ADR 0024`](0024-cubo-isometrico-canonico.md) — a geometria que a projeção contínua usa
- `/home/ondokai/Projects/isometric-maker/packages/iso-core/src/rotation-tween.ts` — a rotação contínua, a suavização e o caminho curto
- `/home/ondokai/Projects/isometric-maker/packages/iso-core/src/rotation-tween.test.ts` — 15 testes, incluindo a concordância exata com a rotação discreta
- `/home/ondokai/Projects/isometric-maker/tools/map-builder/src/scene.ts` — o cross-fade e o laço no ticker

**Última atualização:** 2026-08-01
