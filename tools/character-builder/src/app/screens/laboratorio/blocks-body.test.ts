/**
 * Teste da montagem do body de POST /api/world-block.
 *
 * O que se prova é a regra de omissão: campo em branco NÃO vira `null` nem
 * `''` no request. Mandar vazio troca o default do fornecedor por um palpite
 * nosso — e o default do fornecedor é o que o spec documenta.
 *
 * Execute com: node --test src/app/screens/laboratorio/blocks-body.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildWorldBlockBody, type BlockFormInput } from './blocks-body.ts';

function form(over: Partial<BlockFormInput> = {}): BlockFormInput {
  return {
    description: 'grass on top of dirt',
    size: 48,
    shape: 'block',
    tileUnitSize: '',
    outline: '',
    shading: '',
    detail: '',
    guidanceText: '',
    seedText: '',
    facingMode: 'uniform',
    lockPalette: true,
    ...over,
  };
}

test('descrição vazia ou só espaço → description-missing', () => {
  for (const description of ['', '   ', '\n\t']) {
    const r = buildWorldBlockBody(form({ description }));
    assert.equal(r.ok, false);
    assert.equal(r.ok === false && r.code, 'description-missing');
  }
});

test('descrição é aparada antes de virar body', () => {
  const r = buildWorldBlockBody(form({ description: '  pedra musgosa  ' }));
  assert.ok(r.ok);
  assert.equal(r.ok && r.body.description, 'pedra musgosa');
});

test('size fora de 16–64 ou fracionário → size-invalid', () => {
  for (const size of [15, 65, 48.5, Number.NaN]) {
    const r = buildWorldBlockBody(form({ size }));
    assert.equal(r.ok, false, `size ${size} deveria ser recusado`);
    assert.equal(r.ok === false && r.code, 'size-invalid');
  }
  assert.ok(buildWorldBlockBody(form({ size: 16 })).ok);
  assert.ok(buildWorldBlockBody(form({ size: 64 })).ok);
});

test('seed inválida → seed-invalid; em branco é OMITIDA', () => {
  for (const seedText of ['-1', '2.5', 'abc']) {
    const r = buildWorldBlockBody(form({ seedText }));
    assert.equal(r.ok, false, `seed "${seedText}" deveria ser recusada`);
    assert.equal(r.ok === false && r.code, 'seed-invalid');
  }
  const vazio = buildWorldBlockBody(form({ seedText: '  ' }));
  assert.ok(vazio.ok);
  assert.equal(vazio.ok && 'seed' in vazio.body, false, 'seed em branco não vai no request');

  const ok = buildWorldBlockBody(form({ seedText: '0' }));
  assert.equal(ok.ok && ok.body.seed, 0, 'zero é seed válida, não ausência');
});

test('guidance fora de 1–20 → guidance-invalid; em branco é OMITIDA', () => {
  for (const guidanceText of ['0', '20.5', 'x']) {
    const r = buildWorldBlockBody(form({ guidanceText }));
    assert.equal(r.ok, false, `guidance "${guidanceText}" deveria ser recusada`);
    assert.equal(r.ok === false && r.code, 'guidance-invalid');
  }
  const ok = buildWorldBlockBody(form({ guidanceText: '12.5' }));
  assert.equal(ok.ok && ok.body.textGuidanceScale, 12.5);
  assert.equal(
    buildWorldBlockBody(form()).ok && 'textGuidanceScale' in buildWorldBlockBody(form()),
    false,
  );
});

test('qualidade em branco é OMITIDA do body (não vira null nem string vazia)', () => {
  const r = buildWorldBlockBody(form());
  assert.ok(r.ok);
  if (!r.ok) return;
  for (const key of ['outline', 'shading', 'detail', 'tileUnitSize', 'textGuidanceScale', 'seed']) {
    assert.equal(key in r.body, false, `${key} em branco não pode entrar no request`);
  }
});

test('qualidade informada entra no body', () => {
  const r = buildWorldBlockBody(
    form({
      outline: 'lineless',
      shading: 'medium shading',
      detail: 'highly detailed',
      tileUnitSize: '32',
    }),
  );
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.body.outline, 'lineless');
  assert.equal(r.body.shading, 'medium shading');
  assert.equal(r.body.detail, 'highly detailed');
  assert.equal(r.body.tileUnitSize, 32);
});

test('tileUnitSize fora do enum [16,32] é ignorado em vez de virar valor inválido', () => {
  const r = buildWorldBlockBody(form({ tileUnitSize: '24' }));
  assert.ok(r.ok);
  assert.equal(r.ok && 'tileUnitSize' in r.body, false);
});

test('lockPalette só vai no modo orientado — no uniforme sujaria o hash', () => {
  const uniforme = buildWorldBlockBody(form({ facingMode: 'uniform', lockPalette: true }));
  assert.ok(uniforme.ok);
  assert.equal(uniforme.ok && 'lockPalette' in uniforme.body, false);

  const orientado = buildWorldBlockBody(form({ facingMode: 'oriented', lockPalette: false }));
  assert.ok(orientado.ok);
  assert.equal(orientado.ok && orientado.body.lockPalette, false);
  assert.equal(orientado.ok && orientado.body.facingMode, 'oriented');
});
