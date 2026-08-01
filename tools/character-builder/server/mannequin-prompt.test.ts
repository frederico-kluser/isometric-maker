/**
 * Teste do andaime do modo manequim (server/mannequin-prompt.ts).
 *
 * O ponto de tudo: `template_id: "mannequin"` não tira roupa nenhuma — ele só
 * escolhe o esqueleto que o animador encaixa. Quem tira roupa, cabelo e rosto é
 * este andaime somado ao `negative_description`. Se estes testes quebrarem, o
 * corpo-base volta a nascer vestido.
 *
 * Execute com: node --test server/mannequin-prompt.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMannequinPrompt,
  effectiveDescription,
  MANNEQUIN_BODY,
  MANNEQUIN_COVERAGE,
  MANNEQUIN_NEGATIVE,
} from './mannequin-prompt.ts';

test('o estilo do usuário vem primeiro e o corpo é anexado', () => {
  const { description } = buildMannequinPrompt('ragnarok online 2002, cel-shaded');
  assert.ok(description.startsWith('ragnarok online 2002, cel-shaded, '));
  assert.ok(description.endsWith(MANNEQUIN_BODY));
});

test('estilo vazio ainda produz o corpo — o manequim não depende do texto', () => {
  assert.equal(buildMannequinPrompt('   ').description, MANNEQUIN_BODY);
});

test('vírgula ou espaço sobrando no fim do estilo não vira vírgula dupla', () => {
  const { description } = buildMannequinPrompt('pixel art,  ');
  assert.ok(!description.includes(',,'));
  assert.ok(description.startsWith('pixel art, featureless'));
});

test('o negativo cobre os três reincidentes: roupa, cabelo e rosto', () => {
  const { negativeDescription } = buildMannequinPrompt('qualquer estilo');
  for (const termo of ['clothes', 'armor', 'hair', 'beard', 'face', 'eyes', 'mouth']) {
    assert.ok(
      negativeDescription.includes(termo),
      `"${termo}" precisa estar no negative_description`,
    );
  }
});

test('o positivo pede careca, sem rosto e sem roupa', () => {
  for (const termo of ['bald', 'faceless', 'no clothing']) {
    assert.ok(MANNEQUIN_BODY.includes(termo), `"${termo}" precisa estar no andaime`);
  }
});

test('negativo extra do usuário é concatenado, não substitui', () => {
  const { negativeDescription } = buildMannequinPrompt('estilo', ' , tattoo, scars ');
  assert.ok(negativeDescription.startsWith(MANNEQUIN_NEGATIVE));
  assert.ok(negativeDescription.endsWith('tattoo, scars'));
  assert.ok(!negativeDescription.includes(',,'));
});

test('effectiveDescription só monta o andaime quando o modo está ligado', () => {
  assert.equal(effectiveDescription('um mago de robe azul', false), 'um mago de robe azul');
  assert.equal(effectiveDescription('um mago de robe azul', undefined), 'um mago de robe azul');
  assert.ok(effectiveDescription('estilo', true).includes(MANNEQUIN_BODY));
});

test('a cobertura padrão deixa folga para o contorno', () => {
  assert.ok(MANNEQUIN_COVERAGE > 80 && MANNEQUIN_COVERAGE < 100);
});

test('regerar não empilha o andaime — a descrição efetiva volta igual', () => {
  const primeira = buildMannequinPrompt('pixel art').description;
  // Segunda passada com a descrição EFETIVA como entrada: é o que acontece
  // quando o texto vem de Character.description em vez do histórico.
  const segunda = buildMannequinPrompt(primeira).description;
  assert.equal(segunda, primeira);
  assert.equal(segunda.split('featureless humanoid base body').length - 1, 1);
});
