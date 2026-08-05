/**
 * Teste da montagem do body de POST /api/world-block.
 *
 * O que se prova é a regra de omissão: campo em branco NÃO vira `null` nem
 * `''` no request. Mandar vazio troca o default do fornecedor por um palpite
 * nosso — e o default do fornecedor é o que o spec documenta. E a técnica é
 * SEMPRE `texture`: o laboratório só gera cubos por textura animada (ADR 0032),
 * e a técnica entra no hash do servidor.
 *
 * Exceção à regra: os toggles booleanos (enhancePrompt, pingPong) vão SEMPRE
 * no body. O painel é dono deles — o default do endpoint (enhance_prompt=false)
 * não é o default do painel (ligado), e omitir faria a geração divergir do
 * toggle sem ninguém avisar.
 *
 * Execute com: node --test src/app/screens/laboratorio/blocks-body.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildWorldBlockBody, TILE_DEFAULTS, type BlockFormInput } from './blocks-body.ts';

function form(over: Partial<BlockFormInput> = {}): BlockFormInput {
  return {
    description: 'grass on top of dirt',
    enhancePrompt: true,
    pingPong: true,
    ...over,
  };
}

test('body mínimo: description + técnica fixa + toggles, nada de campo vazio', () => {
  const built = buildWorldBlockBody(form());
  assert.ok(built.ok);
  assert.deepEqual(built.body, {
    description: 'grass on top of dirt',
    technique: 'texture',
    enhancePrompt: true,
    pingPong: true,
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

test('frameCount 0 (Estático) é aceito e vai no body', () => {
  const built = buildWorldBlockBody(form({ frameCount: 0 }));
  assert.ok(built.ok);
  assert.equal(built.body.frameCount, 0);
});

test('action entra aparada quando informada; em branco é omitida', () => {
  const built = buildWorldBlockBody(form({ action: '  água ondulando  ' }));
  assert.ok(built.ok);
  assert.equal(built.body.action, 'água ondulando');

  const semAcao = buildWorldBlockBody(form({ action: '   ' }));
  assert.ok(semAcao.ok);
  assert.ok(!('action' in semAcao.body));
});

/**
 * Os knobs de estilo do tile seguem a regra de omissão, e por dinheiro: no
 * servidor, knob no default do endpoint hasheia igual a knob omitido — mesma
 * arte, mesmo artefato, um pagamento só. Mandar o default de volta faria as
 * duas pontas discordarem sobre o que é "o mesmo bloco".
 */
test('knob no default do fornecedor é OMITIDO do body', () => {
  const built = buildWorldBlockBody(
    form({
      textGuidanceScale: TILE_DEFAULTS.textGuidanceScale,
      outline: TILE_DEFAULTS.outline,
      shading: TILE_DEFAULTS.shading,
      detail: TILE_DEFAULTS.detail,
    }),
  );
  assert.ok(built.ok);
  assert.ok(!('textGuidanceScale' in built.body));
  assert.ok(!('outline' in built.body));
  assert.ok(!('shading' in built.body));
  assert.ok(!('detail' in built.body));
});

test('knob fora do default entra no body', () => {
  const built = buildWorldBlockBody(
    form({
      textGuidanceScale: 14,
      outline: 'selective outline',
      shading: 'detailed shading',
      detail: 'highly detailed',
    }),
  );
  assert.ok(built.ok);
  assert.equal(built.body.textGuidanceScale, 14);
  assert.equal(built.body.outline, 'selective outline');
  assert.equal(built.body.shading, 'detailed shading');
  assert.equal(built.body.detail, 'highly detailed');
});

test('os toggles enhancePrompt e pingPong vão SEMPRE no body, ligados ou não', () => {
  const ligado = buildWorldBlockBody(form());
  assert.ok(ligado.ok);
  assert.equal(ligado.body.enhancePrompt, true);
  assert.equal(ligado.body.pingPong, true);

  const desligado = buildWorldBlockBody(form({ enhancePrompt: false, pingPong: false }));
  assert.ok(desligado.ok);
  assert.equal(desligado.body.enhancePrompt, false);
  assert.equal(desligado.body.pingPong, false);
});
