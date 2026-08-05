/**
 * Teste da lógica de animação de bloco do editor 3D.
 *
 * Não há jsdom nem testing-library neste repositório, e instalar qualquer um
 * dos dois é proibido — então o que se testa aqui é o módulo PURO, que é onde
 * mora tudo que decide o desenho: qual quadro no instante t, o vai-e-volta, se
 * a folha em disco descreve mesmo o cubo, e quando o laço de quadro pode parar.
 * O que sobra em `cube3d.ts`/`scene3d.ts` é a chamada de GPU.
 *
 * Execute com: node --test src/map/3d/block-animation.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BlockAnimator,
  DEFAULT_BLOCK_ANIMATION_FPS,
  animationClipOf,
  checkSheet,
  frameIndexAt,
  frameOffsetU,
  frameRepeatU,
  sheetLayout,
  type AnimationClip,
} from './block-animation.ts';

// ------------------------------------------------------------------ o clipe

test('animationClipOf: o bloco de textura animado vira clipe', () => {
  const clip = animationClipOf({ animated: true, frameCount: 9, fps: 8, pingPong: true });
  assert.deepEqual(clip, { frameCount: 9, fps: 8, pingPong: true });
});

test('animationClipOf: bloco SEM animação devolve null, e por vários motivos', () => {
  // O bloco declarado estático pelo servidor (frameCount 0 na geração).
  assert.equal(animationClipOf({ animated: false, frameCount: 9, fps: 8 }), null);
  // Bloco v2 (4 faces) ou procedural: nenhum campo de animação.
  assert.equal(animationClipOf({}), null);
  // Um quadro só não é animação — e tratá-lo como tal manteria o laço de
  // quadro acordado para nunca trocar nada.
  assert.equal(animationClipOf({ frameCount: 1, fps: 8 }), null);
  assert.equal(animationClipOf({ frameCount: 0 }), null);
  // Lixo vindo do JSON do catálogo.
  assert.equal(animationClipOf({ frameCount: Number.NaN }), null);
  assert.equal(animationClipOf({ frameCount: -4 }), null);
});

test('animationClipOf: os defaults são os mesmos da prévia do laboratório', () => {
  const semFps = animationClipOf({ frameCount: 4 });
  assert.equal(semFps?.fps, DEFAULT_BLOCK_ANIMATION_FPS);
  assert.equal(semFps?.pingPong, true, 'ping-pong só desliga com false explícito');

  assert.equal(animationClipOf({ frameCount: 4, fps: 0 })?.fps, DEFAULT_BLOCK_ANIMATION_FPS);
  assert.equal(
    animationClipOf({ frameCount: 4, fps: Number.POSITIVE_INFINITY })?.fps,
    DEFAULT_BLOCK_ANIMATION_FPS,
  );
  assert.equal(animationClipOf({ frameCount: 4, pingPong: false })?.pingPong, false);
});

// ------------------------------------------------------------------ o tempo

const LINEAR: AnimationClip = { frameCount: 4, fps: 8, pingPong: false };
const VAIVEM: AnimationClip = { frameCount: 4, fps: 8, pingPong: true };

test('frameIndexAt: o quadro sai do tempo e do fps, e o ciclo reinicia', () => {
  // 8 fps = um quadro a cada 125 ms.
  assert.equal(frameIndexAt(0, LINEAR), 0);
  assert.equal(frameIndexAt(124, LINEAR), 0, 'antes de fechar o quadro, nada muda');
  assert.equal(frameIndexAt(125, LINEAR), 1);
  assert.equal(frameIndexAt(374, LINEAR), 2);
  assert.equal(frameIndexAt(375, LINEAR), 3);
  assert.equal(frameIndexAt(500, LINEAR), 0, 'sem ping-pong, volta ao começo');
  assert.equal(frameIndexAt(625, LINEAR), 1);
});

test('frameIndexAt: fps diferente muda a duração do quadro, não a sequência', () => {
  const lento: AnimationClip = { frameCount: 4, fps: 2, pingPong: false };
  assert.equal(frameIndexAt(499, lento), 0);
  assert.equal(frameIndexAt(500, lento), 1);
  assert.equal(frameIndexAt(1000, lento), 2);
  assert.equal(frameIndexAt(2000, lento), 0);

  const rapido: AnimationClip = { frameCount: 4, fps: 16, pingPong: false };
  assert.equal(frameIndexAt(62, rapido), 0);
  assert.equal(frameIndexAt(63, rapido), 1);
});

test('frameIndexAt: ping-pong vai e volta sem repetir os extremos', () => {
  const sequencia = Array.from({ length: 13 }, (_, tick) => frameIndexAt(tick * 125, VAIVEM));
  assert.deepEqual(sequencia, [0, 1, 2, 3, 2, 1, 0, 1, 2, 3, 2, 1, 0]);
});

test('frameIndexAt: ping-pong de 2 quadros alterna, sem divisão por zero', () => {
  const dois: AnimationClip = { frameCount: 2, fps: 8, pingPong: true };
  assert.deepEqual(
    Array.from({ length: 5 }, (_, t) => frameIndexAt(t * 125, dois)),
    [0, 1, 0, 1, 0],
  );
});

test('frameIndexAt: tempo negativo, NaN e quadro único não explodem', () => {
  assert.equal(frameIndexAt(-500, VAIVEM), 0);
  assert.equal(frameIndexAt(Number.NaN, VAIVEM), 0);
  assert.equal(frameIndexAt(9999, { frameCount: 1, fps: 8, pingPong: true }), 0);
});

test('frameIndexAt: o índice NUNCA sai da folha', () => {
  for (const clip of [LINEAR, VAIVEM, { frameCount: 9, fps: 8, pingPong: true }]) {
    for (let ms = 0; ms < 4000; ms += 17) {
      const i = frameIndexAt(ms, clip);
      assert.ok(
        Number.isInteger(i) && i >= 0 && i < clip.frameCount,
        `quadro ${i} fora de 0..${clip.frameCount - 1} em ${ms} ms`,
      );
    }
  }
});

// ------------------------------------------------------------------ a folha

test('sheetLayout: a tira horizontal se divide em quadros iguais', () => {
  assert.deepEqual(sheetLayout(432, 53, 9), { frameWidth: 48, frameHeight: 53, frameCount: 9 });
  assert.deepEqual(sheetLayout(240, 53, 5), { frameWidth: 48, frameHeight: 53, frameCount: 5 });
});

test('sheetLayout: recusa o que não é tira exata — adivinhar pintaria meio quadro do vizinho', () => {
  assert.equal(sheetLayout(430, 53, 9), null, 'largura não múltipla da contagem');
  assert.equal(sheetLayout(432, 53, 1), null, 'um quadro não é animação');
  assert.equal(sheetLayout(432, 53, 0), null);
  assert.equal(sheetLayout(0, 53, 9), null, 'folha que não carregou');
  assert.equal(sheetLayout(432.5, 53, 9), null);
});

test('frameOffsetU/frameRepeatU: a janela da textura é um quadro', () => {
  assert.equal(frameRepeatU(4), 0.25);
  assert.equal(frameOffsetU(0, 4), 0);
  assert.equal(frameOffsetU(2, 4), 0.5);
  assert.equal(frameOffsetU(3, 4), 0.75);
  // Índice fora da faixa é preso, nunca vira janela fora da folha.
  assert.equal(frameOffsetU(9, 4), 0.75);
  assert.equal(frameOffsetU(-1, 4), 0);
});

test('checkSheet: a folha certa passa, com o quadro medido dela', () => {
  const clip: AnimationClip = { frameCount: 9, fps: 8, pingPong: true };
  const verdict = checkSheet({ width: 432, height: 53 }, clip, { width: 48, height: 53 });
  assert.equal(verdict.ok, true);
  assert.ok(verdict.ok && verdict.layout.frameWidth === 48);
  assert.ok(verdict.ok && verdict.layout.frameHeight === 53);
});

/**
 * O caso real dos dois blocos pagos: os frames e o `base.png` estão íntegros em
 * 48×53 e a folha ficou 432×48, gravada pelo código antigo que assumia o quadro
 * quadrado. O servidor re-empacota; se ainda assim chegar assim aqui, o bloco
 * degrada para o quadro parado em vez de mostrar arte cortada.
 */
test('checkSheet: folha que discorda do quadro parado é recusada, com motivo', () => {
  const clip: AnimationClip = { frameCount: 9, fps: 8, pingPong: true };
  const verdict = checkSheet({ width: 432, height: 48 }, clip, { width: 48, height: 53 });
  assert.equal(verdict.ok, false);
  assert.ok(!verdict.ok && /não bate com o quadro parado/.test(verdict.reason));
  assert.ok(!verdict.ok && /48×48/.test(verdict.reason), 'o motivo diz o que ele achou');
  assert.ok(!verdict.ok && /48×53/.test(verdict.reason), 'e o que ele esperava');
});

test('checkSheet: folha que não se divide na contagem é recusada', () => {
  // 240 px em 7 quadros não fecha: o sidecar e a folha discordam, e chutar o
  // resto pintaria o cubo com meio quadro do vizinho.
  const clip: AnimationClip = { frameCount: 7, fps: 8, pingPong: true };
  const verdict = checkSheet({ width: 240, height: 53 }, clip, { width: 48, height: 53 });
  assert.equal(verdict.ok, false);
  assert.ok(!verdict.ok && /não se divide em 7 quadros/.test(verdict.reason));
});

test('checkSheet: sem quadro parado para comparar, o critério é a forma do cubo', () => {
  const clip: AnimationClip = { frameCount: 4, fps: 8, pingPong: true };
  // 48×53 é cubo: passa mesmo sem régua.
  assert.equal(checkSheet({ width: 192, height: 53 }, clip, null).ok, true);
  // 48×24 não tem aresta vertical — é losango solto, não descreve volume.
  const chato = checkSheet({ width: 192, height: 24 }, clip, null);
  assert.equal(chato.ok, false);
  assert.ok(!chato.ok && /não tem aresta\s+vertical/.test(chato.reason.replace(/\s+/g, ' ')));
});

// ------------------------------------------------------------------ o animador

/** Um espião de quadros: registra o que o bloco foi mandado mostrar. */
function spy(): { shown: number[]; show: (i: number) => void } {
  const shown: number[] = [];
  return { shown, show: (i: number) => shown.push(i) };
}

test('BlockAnimator: só desenha quando o quadro TROCA', () => {
  const animator = new BlockAnimator();
  const grama = spy();
  animator.register('wb:grama', VAIVEM, grama.show);
  animator.setActive(['wb:grama']);

  // O primeiro advance fixa a origem do tempo e aplica o quadro 0.
  assert.equal(animator.advance(1000), true);
  assert.deepEqual(grama.shown, [0]);
  // Mesmo quadro, três voltas do laço: nenhum desenho pedido. É isto que
  // impede uma animação de 8 fps de virar 60 desenhos por segundo.
  assert.equal(animator.advance(1016), false);
  assert.equal(animator.advance(1033), false);
  assert.equal(animator.advance(1124), false);
  assert.equal(animator.advance(1125), true);
  assert.deepEqual(grama.shown, [0, 1]);
});

test('BlockAnimator: hasLive é o que deixa o laço de quadro parar sozinho', () => {
  const animator = new BlockAnimator();
  // Nada registrado: nada vivo. O editor abre sem bloco animado e o laço para.
  assert.equal(animator.hasLive(), false);

  animator.register('wb:agua', VAIVEM, spy().show);
  assert.equal(
    animator.hasLive(),
    false,
    'registrado é "sabe animar"; sem estar NO MAPA não mantém o laço em pé',
  );

  animator.setActive(['wb:agua']);
  assert.equal(animator.hasLive(), true);

  // O último bloco animado saiu do mapa: o laço volta a poder parar.
  animator.setActive([]);
  assert.equal(animator.hasLive(), false);
  assert.equal(animator.advance(5000), false, 'sem nada ativo, nada avança');
});

test('BlockAnimator: bloco da paleta que não está no mapa é ignorado', () => {
  const animator = new BlockAnimator();
  const naPaleta = spy();
  const noMapa = spy();
  animator.register('wb:so-na-paleta', VAIVEM, naPaleta.show);
  animator.register('wb:no-mapa', VAIVEM, noMapa.show);
  animator.setActive(['wb:no-mapa', 'wb:inexistente']);

  animator.advance(0);
  animator.advance(125);
  assert.deepEqual(noMapa.shown, [0, 1]);
  assert.deepEqual(naPaleta.shown, [], 'bloco fora do mapa não gasta nada');
});

test('BlockAnimator: desligar devolve o bloco ao quadro 0 e nada mais anima', () => {
  const animator = new BlockAnimator();
  const bloco = spy();
  animator.register('wb:fogo', VAIVEM, bloco.show);
  animator.setActive(['wb:fogo']);
  animator.advance(0);
  animator.advance(250);
  assert.deepEqual(bloco.shown, [0, 2]);

  animator.setEnabled(false);
  assert.deepEqual(bloco.shown, [0, 2, 0], 'desligar volta ao quadro parado');
  assert.equal(animator.hasLive(), false, 'e o laço pode parar');
  assert.equal(animator.advance(1000), false);

  animator.setEnabled(true);
  assert.equal(animator.hasLive(), true);
});

test('BlockAnimator: clear esquece tudo — é o que a troca de paleta e o destroy fazem', () => {
  const animator = new BlockAnimator();
  const bloco = spy();
  animator.register('wb:pedra', VAIVEM, bloco.show);
  animator.setActive(['wb:pedra']);
  animator.advance(0);

  animator.clear();
  assert.equal(animator.hasLive(), false);
  assert.equal(animator.advance(9999), false, 'clipe descartado não toca em textura morta');
  assert.deepEqual(bloco.shown, [0]);
});

test('BlockAnimator: dois blocos com fps diferentes avançam cada um no seu tempo', () => {
  const animator = new BlockAnimator();
  const rapido = spy();
  const lento = spy();
  animator.register('wb:rapido', { frameCount: 4, fps: 8, pingPong: false }, rapido.show);
  animator.register('wb:lento', { frameCount: 4, fps: 2, pingPong: false }, lento.show);
  animator.setActive(['wb:rapido', 'wb:lento']);

  animator.advance(0);
  animator.advance(125);
  animator.advance(250);
  animator.advance(500);
  assert.deepEqual(rapido.shown, [0, 1, 2, 0]);
  assert.deepEqual(lento.shown, [0, 1]);
});

test('BlockAnimator: a origem do tempo é o primeiro advance, não o relógio absoluto', () => {
  const animator = new BlockAnimator();
  const bloco = spy();
  animator.register('wb:x', LINEAR, bloco.show);
  animator.setActive(['wb:x']);
  // `performance.now()` já está em milhões de milissegundos quando o editor
  // abre; sem a origem própria o bloco começaria num quadro arbitrário.
  animator.advance(1_234_567);
  assert.deepEqual(bloco.shown, [0]);
  animator.advance(1_234_567 + 125);
  assert.deepEqual(bloco.shown, [0, 1]);
});
