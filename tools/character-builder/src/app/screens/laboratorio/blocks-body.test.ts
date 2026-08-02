/**
 * Teste da montagem do body de POST /api/world-block.
 *
 * O que se prova é a regra de omissão: campo em branco NÃO vira `null` nem
 * `''` no request. Mandar vazio troca o default do fornecedor por um palpite
 * nosso — e o default do fornecedor é o que o spec documenta. E a técnica
 * sempre acompanha o body, porque ela entra no hash do servidor.
 *
 * Execute com: node --test src/app/screens/laboratorio/blocks-body.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildWorldBlockBody, type BlockFormInput } from './blocks-body.ts';

function form(over: Partial<BlockFormInput> = {}): BlockFormInput {
  return {
    description: 'grass on top of dirt',
    shape: 'block',
    tileUnitSize: '',
    outline: '',
    shading: '',
    detail: '',
    guidanceText: '',
    seedText: '',
    technique: 'chained',
    ...over,
  };
}

test('body mínimo: description + shape + technique, nada de campo vazio', () => {
  const built = buildWorldBlockBody(form());
  assert.ok(built.ok);
  assert.deepEqual(built.body, {
    description: 'grass on top of dirt',
    shape: 'block',
    technique: 'chained',
  });
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

test('seed inválida → seed-invalid; válida vira número', () => {
  for (const seedText of ['-1', '1.5', 'abc']) {
    const built = buildWorldBlockBody(form({ seedText }));
    assert.ok(!built.ok, `"${seedText}" tinha que falhar`);
    assert.equal(built.code, 'seed-invalid');
  }
  const ok = buildWorldBlockBody(form({ seedText: ' 42 ' }));
  assert.ok(ok.ok);
  assert.equal(ok.body.seed, 42);
});

test('guidance fora de 1–20 → guidance-invalid; válida aceita fração', () => {
  for (const guidanceText of ['0', '21', 'x']) {
    const built = buildWorldBlockBody(form({ guidanceText }));
    assert.ok(!built.ok, `"${guidanceText}" tinha que falhar`);
    assert.equal(built.code, 'guidance-invalid');
  }
  const ok = buildWorldBlockBody(form({ guidanceText: '7.5' }));
  assert.ok(ok.ok);
  assert.equal(ok.body.textGuidanceScale, 7.5);
});

test('tileUnitSize só entra quando é 16 ou 32', () => {
  const ok = buildWorldBlockBody(form({ tileUnitSize: '32' }));
  assert.ok(ok.ok);
  assert.equal(ok.body.tileUnitSize, 32);

  const fora = buildWorldBlockBody(form({ tileUnitSize: '24' }));
  assert.ok(fora.ok);
  assert.equal(fora.body.tileUnitSize, undefined, '24 não é do enum e é omitido');
});

test('as duas técnicas passam no body — são dois artefatos do mesmo prompt', () => {
  const chained = buildWorldBlockBody(form({ technique: 'chained' }));
  const rotated = buildWorldBlockBody(form({ technique: 'rotated' }));
  assert.ok(chained.ok && rotated.ok);
  assert.equal(chained.body.technique, 'chained');
  assert.equal(rotated.body.technique, 'rotated');
});

test('qualidade preenchida entra; em branco é omitida', () => {
  const built = buildWorldBlockBody(
    form({ outline: 'lineless', shading: 'basic shading', detail: 'medium detail' }),
  );
  assert.ok(built.ok);
  assert.equal(built.body.outline, 'lineless');
  assert.equal(built.body.shading, 'basic shading');
  assert.equal(built.body.detail, 'medium detail');

  const vazio = buildWorldBlockBody(form());
  assert.ok(vazio.ok);
  assert.ok(!('outline' in vazio.body));
  assert.ok(!('shading' in vazio.body));
  assert.ok(!('detail' in vazio.body));
});
