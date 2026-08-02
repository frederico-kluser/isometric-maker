/**
 * Testes de regressão: o degrau e a gravidade têm de concordar sobre o chão.
 *
 * ## O defeito que estes testes existem para apanhar
 *
 * O motor subia o `z` mal existisse um degrau numa célula **vizinha**, com o
 * personagem ainda em cima da célula baixa. A gravidade, avaliando a célula
 * onde o personagem **está**, via um `z` sem suporte e desfazia o degrau antes
 * da travessia acontecer. As duas regras olhavam para células diferentes, e a
 * mais recente ganhava.
 *
 * O sintoma media-se assim: com `fallSpeed = 12`, um degrau em `x = 1` era
 * escalável e um degrau em `x = 2..8` não era. Mexendo só em `fallSpeed`, o
 * conjunto de degraus escaláveis mudava — ou seja, **a geometria deixava de
 * decidir se um degrau é escalável**, e passava a decidir a fase do acumulador
 * de queda contra o instante da travessia de célula.
 *
 * A propriedade que estes testes fixam é essa, e não um valor: `fallSpeed` não
 * pode mudar o resultado de um degrau.
 *
 * Execute com: node --test src/step-gravity-agreement.test.ts
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CollisionMap } from './collision.ts';
import { BlockStore, EdgeStore, type EdgeSide } from './map.ts';
import {
  step,
  createMovementState,
  DEFAULT_CONFIG,
  type MovementConfig,
  type MovementInput,
} from './movement.ts';
import { runTrace, stepUpInput, NO_INPUT, type TraceFrame } from './trace.ts';

// ------------------------------------------------------------------ fake map

class FakeStepGravityMap implements CollisionMap {
  private blocks = new Set<string>();

  hasBlock(x: number, y: number, z: number): boolean {
    return this.blocks.has(`${x}:${y}:${z}`);
  }

  hasEdge(_x: number, _y: number, _z: number, _lado: EdgeSide): boolean {
    return false;
  }

  /** Empilha `count` blocos a partir de z=0. Topo sólido fica em `count`. */
  addColumn(x: number, y: number, count: number): void {
    for (let z = 0; z < count; z++) this.blocks.add(`${x}:${y}:${z}`);
  }
}

/**
 * Chão liso com topo em z=1 em toda a região, e um único degrau de um nível
 * (topo em z=2) na célula `(stepX, stepY)`.
 */
function flatWithStep(stepX: number, stepY: number): FakeStepGravityMap {
  const map = new FakeStepGravityMap();
  for (let x = -12; x <= 12; x++) {
    for (let y = -12; y <= 12; y++) map.addColumn(x, y, 1);
  }
  map.addColumn(stepX, stepY, 2);
  return map;
}

/**
 * Chão liso com topo em z=1, e um **planalto** de topo z=2 de `fromX` para
 * leste na linha `y = 0`.
 *
 * Existe porque um degrau de 1×1 deixou de ser suficiente para observar que o
 * degrau persiste: sair da beirada agora é cair, e quem sobe a um pilar de uma
 * célula cai dele na travessia seguinte — legitimamente. Um planalto separa as
 * duas perguntas: "a gravidade desfaz o degrau?" (não) de "andar para fora de
 * uma plataforma faz cair?" (sim, e é intencional).
 */
function flatWithPlateauEast(fromX: number): FakeStepGravityMap {
  const map = new FakeStepGravityMap();
  for (let x = -12; x <= 12; x++) {
    for (let y = -12; y <= 12; y++) map.addColumn(x, y, 1);
  }
  for (let x = fromX; x <= 12; x++) map.addColumn(x, 0, 2);
  return map;
}

const FALL_SPEEDS = [0, 6, 12, 60] as const;

const CARDINALS: readonly (readonly [string, number, number])[] = [
  ['leste', 1, 0],
  ['oeste', -1, 0],
  ['norte', 0, 1],
  ['sul', 0, -1],
];

const DIAGONALS: readonly (readonly [string, number, number])[] = [
  ['nordeste', 1, 1],
  ['noroeste', -1, 1],
  ['sudeste', 1, -1],
  ['sudoeste', -1, -1],
];

/**
 * Corre com `stepUp` segurado na direcção dada, contra um degrau colocado a
 * `distance` células nessa direcção, e pára **assim que o personagem chega à
 * célula do degrau**. Devolve o z final e se ficou bloqueado.
 *
 * ## Por que a duração é calculada e não é uma constante
 *
 * Este helper corria 3 s fixos, o que levava o personagem muito para lá do
 * degrau. Isso só dava `z = 2` no fim porque o motor **recusava sair de uma
 * célula sem suporte**: o personagem subia para o degrau de 1×1 e ficava preso
 * em cima dele. Medir o z depois de 3 s media, na verdade, o encalhe.
 *
 * Sair da beirada passou a ser uma queda, e com isso o mesmo traço de 3 s
 * mede a **descida** do outro lado do degrau — cuja duração depende, essa sim,
 * de `fallSpeed`. A propriedade que este ficheiro fixa (a geometria decide se
 * um degrau é escalável, não a fase do acumulador de queda) exige portanto
 * medir o instante da **subida**, não um instante arbitrário depois dela.
 *
 * A duração é o tempo exacto para o eixo em movimento percorrer `distance`
 * células: `distance * |(dx, dy)| / speed`. Para uma cardinal isso é
 * `distance / speed`; para uma diagonal, `distance * √2 / speed`, porque a
 * velocidade é repartida pelos dois eixos. O personagem acaba dentro da célula
 * do degrau e ainda não teve como sair dela.
 */
function climb(
  dx: number,
  dy: number,
  distance: number,
  fallSpeed: number,
): { z: number; blocked: boolean } {
  const map = flatWithStep(dx * distance, dy * distance);
  const config: MovementConfig = { ...DEFAULT_CONFIG, fallSpeed };
  const duration = (distance * Math.hypot(dx, dy)) / config.speed;
  const frames: TraceFrame[] = [{ duration, input: stepUpInput(dx, dy) }];
  const result = runTrace(map, 0.5, 0.5, 1, frames, config);
  return { z: result.finalState.z, blocked: result.blocked };
}

// ------------------------------------------------------------------ varredura cardinal

describe('degrau cardinal: a distância e a velocidade de queda são irrelevantes', () => {
  for (const [nome, dx, dy] of CARDINALS) {
    for (const fallSpeed of FALL_SPEEDS) {
      it(`${nome}, fallSpeed=${fallSpeed}: sobe o degrau a qualquer distância d=1..8`, () => {
        const obtido: number[] = [];
        for (let d = 1; d <= 8; d++) {
          obtido.push(climb(dx, dy, d, fallSpeed).z);
        }
        assert.deepStrictEqual(
          obtido,
          [2, 2, 2, 2, 2, 2, 2, 2],
          `z final por distância (${nome}, fallSpeed=${fallSpeed})`,
        );
      });
    }
  }

  it('mudar apenas fallSpeed não muda nenhum resultado', () => {
    for (const [nome, dx, dy] of CARDINALS) {
      for (let d = 1; d <= 8; d++) {
        const resultados = FALL_SPEEDS.map((fs) => climb(dx, dy, d, fs).z);
        const distintos = new Set(resultados);
        assert.strictEqual(
          distintos.size,
          1,
          `${nome} d=${d}: fallSpeed alterou o resultado → ${resultados.join(',')}`,
        );
      }
    }
  });
});

// ------------------------------------------------------------------ varredura diagonal

describe('degrau diagonal: lacuna herdada, mas insensível à gravidade', () => {
  // `canStepUp` exige adjacência cardinal (`edgeSides` devolve null na
  // diagonal), portanto um degrau alcançado por travessia diagonal nunca foi
  // escalável — nem antes da gravidade existir. Medido no branch `main`:
  // diag d=1..8 → [1,1,1,1,1,1,1,1]. Isto NÃO é uma decisão nova; é uma
  // limitação registada. Se alguém implementar degrau diagonal, este teste
  // falha e obriga a actualizá-lo de propósito.
  it('o personagem não sobe e fica bloqueado no degrau diagonal', () => {
    for (const [nome, dx, dy] of DIAGONALS) {
      for (let d = 1; d <= 8; d++) {
        const r = climb(dx, dy, d, 12);
        assert.strictEqual(r.z, 1, `${nome} d=${d}: z final`);
        assert.strictEqual(r.blocked, true, `${nome} d=${d}: devia bloquear`);
      }
    }
  });

  it('mudar apenas fallSpeed não muda o resultado diagonal', () => {
    for (const [nome, dx, dy] of DIAGONALS) {
      for (let d = 1; d <= 8; d++) {
        const resultados = FALL_SPEEDS.map((fs) => climb(dx, dy, d, fs).z);
        const distintos = new Set(resultados);
        assert.strictEqual(
          distintos.size,
          1,
          `${nome} d=${d}: fallSpeed alterou o resultado → ${resultados.join(',')}`,
        );
      }
    }
  });
});

// ------------------------------------------------------------------ o degrau persiste

describe('o degrau persiste — não é desfeito no passo seguinte', () => {
  function eastStepUp(): MovementInput {
    return { dir: { x: 1, y: 0 }, jump: false, stepUp: true, stepDown: false };
  }

  it('runTrace: o z fica em 2 do momento da subida até ao fim do traço', () => {
    // Planalto a partir de x=3, e não um degrau de 1×1: a partir do momento em
    // que sair da beirada passou a ser uma queda, um pilar de uma célula não
    // distingue "a gravidade desfez o degrau" (o defeito) de "o personagem
    // andou para fora da plataforma" (o comportamento pedido).
    const map = flatWithPlateauEast(3);
    const config: MovementConfig = { ...DEFAULT_CONFIG, fallSpeed: 12 };

    // Amostra o z ao longo do tempo em traços de duração crescente. Depois de
    // subir, nenhum instante posterior pode voltar a z=1.
    let subiu = false;
    for (let t = 1; t <= 40; t++) {
      const dur = t * 0.05;
      const r = runTrace(
        map,
        0.5,
        0.5,
        1,
        [{ duration: dur, input: stepUpInput(1, 0) }],
        config,
      );
      const z = r.finalState.z;
      if (subiu) {
        assert.strictEqual(z, 2, `t=${dur.toFixed(2)}s: o degrau foi desfeito`);
      } else if (z === 2) {
        subiu = true;
      }
    }
    assert.ok(subiu, 'o personagem nunca subiu o degrau');
  });

  it('step com mapa: sobe na travessia e mantém-se lá parado', () => {
    const map = flatWithStep(1, 0);
    const config: MovementConfig = { ...DEFAULT_CONFIG, fallSpeed: 12 };

    // Anda para leste até atravessar para a célula do degrau.
    let state = createMovementState(0.5, 0.5, 1);
    for (let i = 0; i < 10; i++) {
      state = step(state, eastStepUp(), DEFAULT_CONFIG.fixedDt, config, map);
    }
    assert.strictEqual(Math.floor(state.pos.x), 1, 'devia ter atravessado para (1,0)');
    assert.strictEqual(state.z, 2, 'devia ter subido o degrau na travessia');

    // Parado em cima do degrau: a gravidade não tem nada a dizer, durante
    // muito mais tempo do que um intervalo de queda.
    for (let i = 0; i < 300; i++) {
      state = step(state, NO_INPUT, DEFAULT_CONFIG.fixedDt, config, map);
      assert.strictEqual(state.z, 2, `passo ${i}: o degrau foi desfeito`);
      assert.strictEqual(state.falling, false, `passo ${i}: não devia estar a cair`);
    }
  });

  it('step com mapa: o z não oscila enquanto se anda sobre um planalto', () => {
    // Planalto de topo z=2 de x=1 a x=8; o personagem sobe uma vez e fica.
    const map = new FakeStepGravityMap();
    for (let x = -2; x <= 12; x++) map.addColumn(x, 0, 1);
    for (let x = 1; x <= 8; x++) map.addColumn(x, 0, 2);
    const config: MovementConfig = { ...DEFAULT_CONFIG, fallSpeed: 12 };

    let state = createMovementState(0.5, 0.5, 1);
    const vistos: number[] = [];
    for (let i = 0; i < 100; i++) {
      state = step(state, eastStepUp(), DEFAULT_CONFIG.fixedDt, config, map);
      vistos.push(state.z);
    }
    // A sequência tem de ser monótona não-decrescente: 1…1 seguido de 2…2.
    for (let i = 1; i < vistos.length; i++) {
      assert.ok(
        vistos[i]! >= vistos[i - 1]!,
        `o z desceu no passo ${i}: ${vistos[i - 1]} → ${vistos[i]} (oscilação)`,
      );
    }
    assert.strictEqual(vistos[vistos.length - 1], 2, 'devia acabar em cima do planalto');
  });
});

// ------------------------------------------------------------------ fixture, com valores exactos

/**
 * A mesma geometria dos traços 2 e 3 de `trace.test.ts`, com asserções
 * **exactas**.
 *
 * As asserções de lá são frouxas de origem — `z >= 2` e "célula x é 0 ou 1"
 * não distinguem certo de errado, e por isso o traço 2 continuou verde
 * enquanto o degrau era desfeito pela gravidade. Aqueles testes são
 * pré-existentes e não foram tocados; esta secção fixa os valores únicos que
 * a geometria determina, para que a próxima regressão do género falhe.
 */
describe('fixture mapa-degraus: valores exactos', () => {
  const fixtureDir = dirname(fileURLToPath(import.meta.url));

  function fixtureMap(): CollisionMap {
    const raw = readFileSync(
      join(fixtureDir, '..', 'test-fixtures', 'mapa-degraus.json'),
      'utf-8',
    );
    const parsed = JSON.parse(raw) as {
      mapa: {
        blocks: Record<string, readonly { block: string; count: number }[]>;
        edges: readonly { x: number; y: number; z: number; lado: string; tipo: string }[];
      };
    };
    const blocks = BlockStore.fromRle(parsed.mapa.blocks);
    const edges = EdgeStore.fromEntries(
      parsed.mapa.edges.map((e) => ({ ...e, lado: e.lado as EdgeSide })),
    );
    return {
      hasBlock(x, y, z) {
        const b = blocks.getBlock(x, y, z);
        return b !== undefined && b !== '';
      },
      hasEdge(x, y, z, lado) {
        return edges.getEdge(x, y, z, lado) !== undefined;
      },
    };
  }

  it('subir um degrau: acaba exactamente na célula (1,0) em z=2', () => {
    const r = runTrace(fixtureMap(), 0.5, 0.5, 1, [
      { duration: 0.25, input: stepUpInput(1, 0) },
    ]);
    assert.strictEqual(r.finalState.z, 2);
    assert.strictEqual(Math.floor(r.finalState.pos.x), 1);
    assert.strictEqual(Math.floor(r.finalState.pos.y), 0);
    assert.strictEqual(r.finalState.falling, false);
    assert.strictEqual(r.blocked, false);
    assert.strictEqual(r.totalSteps, 15);
  });

  it('subir dois degraus: acaba exactamente na célula (2,0) em z=3', () => {
    const r = runTrace(fixtureMap(), 1.5, 0.5, 2, [
      { duration: 0.25, input: stepUpInput(1, 0) },
    ]);
    assert.strictEqual(r.finalState.z, 3);
    assert.strictEqual(Math.floor(r.finalState.pos.x), 2);
    assert.strictEqual(Math.floor(r.finalState.pos.y), 0);
    assert.strictEqual(r.finalState.falling, false);
    assert.strictEqual(r.blocked, false);
    assert.strictEqual(r.totalSteps, 15);
  });

  it('a fixture dá o mesmo resultado com qualquer fallSpeed', () => {
    for (const fallSpeed of FALL_SPEEDS) {
      const config: MovementConfig = { ...DEFAULT_CONFIG, fallSpeed };
      const r = runTrace(
        fixtureMap(),
        0.5,
        0.5,
        1,
        [{ duration: 0.25, input: stepUpInput(1, 0) }],
        config,
      );
      assert.strictEqual(r.finalState.z, 2, `fallSpeed=${fallSpeed}`);
    }
  });
});
