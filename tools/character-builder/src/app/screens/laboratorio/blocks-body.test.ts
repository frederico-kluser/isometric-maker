/**
 * Teste da montagem do body de POST /api/world-block.
 *
 * O que se prova é a regra de omissão: campo em branco NÃO vira `null` nem
 * `''` no request. Mandar vazio troca o default do fornecedor por um palpite
 * nosso — e o default do fornecedor é o que o spec documenta. E a técnica é
 * SEMPRE `texture`: o laboratório só gera cubos por textura animada (ADR 0032),
 * e a técnica entra no hash do servidor.
 *
 * Execute com: node --test src/app/screens/laboratorio/blocks-body.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildWorldBlockBody, type BlockFormInput } from './blocks-body.ts';

function form(over: Partial<BlockFormInput> = {}): BlockFormInput {
  return {
    description: 'grass on top of dirt',
    ...over,
  };
}

test('body mínimo: description + técnica fixa, nada de campo vazio', () => {
  const built = buildWorldBlockBody(form());
  assert.ok(built.ok);
  assert.deepEqual(built.body, {
    description: 'grass on top of dirt',
    technique: 'texture',
  });
});

test('a técnica é SEMPRE texture — não existe mais escolha de técnica', () => {
  const built = buildWorldBlockBody(form());
  assert.ok(built.ok);
  assert.equal(built.body.technique, 'texture');
});

test('description vazia ou só espaços → description-missing', () => {
  for (const description of ['', '   ']) {
    const built = buildWorldBlockBody(form({ description }));
    assert.ok(!built.ok);
    assert.equal(built.code, 'description-missing');
  }
});

test('a description é aparada antes de ir', () => {
  const built = buildWorldBlockBody(form({ description: '  mossy stone  ' }));
  assert.ok(built.ok);
  assert.equal(built.body.description, 'mossy stone');
});

test('frameCount e fps entram quando informados; em branco são omitidos', () => {
  const built = buildWorldBlockBody(form({ frameCount: 16, fps: 12 }));
  assert.ok(built.ok);
  assert.equal(built.body.frameCount, 16);
  assert.equal(built.body.fps, 12);

  const vazio = buildWorldBlockBody(form());
  assert.ok(vazio.ok);
  assert.ok(!('frameCount' in vazio.body));
  assert.ok(!('fps' in vazio.body));
});
