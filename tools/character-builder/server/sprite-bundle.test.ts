/**
 * Testes de server/sprite-bundle.ts — bundles JSON do Sprite Studio/wizard.
 *
 * Sem rede, sem API: studios em memória (StudioStoreLike falso) e PNGs
 * sintéticos em tmpdir (mesmo padrão de mannequin-io.test.ts).
 *
 * Propriedades verificadas:
 *   1. parse rejeita kinds errados ("config normal"), version errada e campos
 *      ausentes/inválidos — sempre com erro nomeando o campo;
 *   2. parse valida PNGs (não-PNG e fora da faixa 32–256 são recusados);
 *   3. export exige wizard.etapa 'pronto', lock e células prontas, e lê a sul
 *      ATIVA via wizard.activeSouth;
 *   4. roundtrip export→parse→import reproduz células prontas, personagem e
 *      bytes de PNG;
 *   5. import de lab → etapa 'direcoes8', remoteId removido, direções velhas
 *      apagadas; import de wizard → 'pronto' + remoteId do bundle;
 *   6. lock: ausente → trava (8/8 no lab, valores do bundle no wizard);
 *      presente com size divergente → erro em pt-BR sem gravar nada;
 *   7. alvo 'new': id=slug, conflito = erro, silhueta do bundle ou herdada do
 *      manequim; alvo 'existing': exige personagem com wizard state;
 *   8. reimport no mesmo alvo 'existing' é idempotente (createdAt preservado).
 *
 * Execute com: node --test server/sprite-bundle.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import {
	DIRECTIONS,
	directions8Key,
	seedStudio,
	southKey,
	type Character,
	type Studio,
} from './model.ts';
import {
	exportWizardBundle,
	importSpriteBundle,
	parseSpriteBundle,
	type LabBundle,
	type StudioStoreLike,
	type WizardBundle,
} from './sprite-bundle.ts';

// =====================================================================
// fixtures — PNG sintético (padrão de src/import.test.ts)
// =====================================================================

const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
	let c = i;
	for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
	CRC_TABLE[i] = c;
}

function crc32(buf: Buffer): number {
	let c = 0xffffffff;
	for (const b of buf) {
		c = CRC_TABLE[(c ^ b)! & 0xff]! ^ (c >>> 8);
	}
	return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
	const len = Buffer.alloc(4);
	len.writeUInt32BE(data.length, 0);
	const t = Buffer.from(type, 'ascii');
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
	return Buffer.concat([len, t, data, crc]);
}

/** PNG RGB 8bpc válido; `fill` distingue os bytes entre arquivos. */
function makePNG(width: number, height: number, fill = 0): Buffer {
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(width, 0);
	ihdr.writeUInt32BE(height, 4);
	ihdr[8] = 8; // bit depth
	ihdr[9] = 2; // colour type RGB
	const rowLen = 1 + width * 3;
	const raw = Buffer.alloc(height * rowLen, fill & 0xff);
	return Buffer.concat([
		Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
		pngChunk('IHDR', ihdr),
		pngChunk('IDAT', deflateSync(raw)),
		pngChunk('IEND', Buffer.alloc(0)),
	]);
}

const b64 = (buf: Buffer): string => buf.toString('base64');

// =====================================================================
// fixtures — diretórios temporários e store em memória
// =====================================================================

function tmpDir(): string {
	const dir = join(tmpdir(), `sprite-bundle-test-${randomBytes(4).toString('hex')}`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

function memoryStore(initial: Studio): {
	store: StudioStoreLike;
	saves: Studio[];
	current: () => Studio;
} {
	let current = initial;
	const saves: Studio[] = [];
	return {
		store: {
			load: () => Promise.resolve(current),
			save: (s: Studio) => {
				saves.push(s);
				current = s;
				return Promise.resolve();
			},
		},
		saves,
		current: () => current,
	};
}

/** Confere que nada foi gravado: nem save, nem arquivo do personagem. */
function assertNothingWritten(saves: Studio[], assetsDir: string, characterId: string): void {
	assert.equal(saves.length, 0, 'store.save não deveria ter sido chamado');
	assert.equal(
		existsSync(join(assetsDir, 'wizard', characterId)),
		false,
		'nenhum PNG deveria ter sido gravado',
	);
}

// =====================================================================
// fixtures — studio pronto com PNGs em disco + bundles válidos
// =====================================================================

const SIZE = 64;
const LOCK = { frameCount: 8, fps: 8, size: SIZE } as const;

const SOUTH_FILL = 10;
const DIR_FILLS: Record<string, number> = {
	south: 30,
	'south-west': 31,
	west: 32,
	'north-west': 33,
	north: 34,
	'north-east': 35,
	east: 36,
	'south-east': 37,
};

/** Mesma derivação de frames.ts — pasta das 8 direções de um personagem. */
const safe8 = (characterId: string): string =>
	directions8Key(characterId).replace(/[^a-z0-9-]+/gi, '_');

/**
 * Grava os PNGs da sul e das 8 direções de "heroi" em `srcAssets` e devolve
 * um studio com o personagem pronto cujas células apontam para eles.
 */
function readyStudioWithFiles(srcAssets: string): Studio {
	mkdirSync(join(srcAssets, 'wizard', 'heroi'), { recursive: true });
	writeFileSync(
		join(srcAssets, 'wizard', 'heroi', 'south-v0.png'),
		makePNG(SIZE, SIZE, SOUTH_FILL),
	);
	mkdirSync(join(srcAssets, 'wizard', safe8('heroi')), { recursive: true });
	for (const d of DIRECTIONS) {
		writeFileSync(
			join(srcAssets, 'wizard', safe8('heroi'), `${d}-00.png`),
			makePNG(SIZE, SIZE, DIR_FILLS[d]!),
		);
	}

	const heroi: Character = {
		id: 'heroi',
		label: 'Herói',
		silhouette: 'humano-esguio',
		description: 'grey hero, bald',
		size: SIZE,
		seed: 42,
		wizard: {
			etapa: 'pronto',
			southVersions: [{ prompt: 'grey hero', at: '2026-07-31T00:00:00.000Z' }],
			activeSouth: 0,
		},
		remoteId: 'char-remote-123',
		createdAt: '2026-07-31T00:00:00.000Z',
	};

	return {
		...seedStudio(),
		lock: { ...LOCK },
		characters: [heroi],
		cells: {
			[southKey('heroi')]: {
				key: southKey('heroi'),
				status: 'pronto',
				frames: { south: ['/assets/wizard/heroi/south-v0.png'] },
			},
			[directions8Key('heroi')]: {
				key: directions8Key('heroi'),
				status: 'pronto',
				frames: Object.fromEntries(
					DIRECTIONS.map((d) => [d, [`/assets/wizard/${safe8('heroi')}/${d}-00.png`]]),
				),
			},
		},
	};
}

/** Bundle do wizard válido, construído em memória (sem passar pelo export). */
function validWizardBundle(): WizardBundle {
	return {
		kind: 'sprite-wizard-directions',
		version: 1,
		exportedAt: '2026-08-01T12:00:00.000Z',
		config: {
			description: 'grey hero, bald',
			view: 'low top-down',
			size: SIZE,
			seed: 7,
			silhouette: 'humano-medio',
			templateId: 'mannequin',
			frameCount: 8,
			fps: 8,
		},
		remoteId: 'char-remote-999',
		south: { b64: b64(makePNG(SIZE, SIZE, SOUTH_FILL)) },
		directions: Object.fromEntries(
			DIRECTIONS.map((d) => [d, b64(makePNG(SIZE, SIZE, DIR_FILLS[d]!))]),
		) as Record<(typeof DIRECTIONS)[number], string>,
	};
}

/** Bundle do laboratório válido: dois candidatos, o segundo selecionado. */
function validLabBundle(): LabBundle {
	return {
		kind: 'sprite-lab-south',
		version: 1,
		exportedAt: '2026-08-01T13:00:00.000Z',
		config: {
			description: 'armored knight, heavy plate',
			view: 'low top-down',
			size: SIZE,
			seed: 5,
			noBackground: true,
			enhancePrompt: false,
			templateId: 'mannequin',
		},
		selected: { index: 1, seed: 6, b64: b64(makePNG(SIZE, SIZE, 51)) },
		candidates: [
			{ index: 0, seed: 5, b64: b64(makePNG(SIZE, SIZE, 50)) },
			{ index: 1, seed: 6, b64: b64(makePNG(SIZE, SIZE, 51)) },
		],
	};
}

// =====================================================================
// parse — kinds errados e campos ausentes
// =====================================================================

test('parse — rejeita kind errado, ausente e não-objeto, nomeando o campo', () => {
	assert.throws(
		() => parseSpriteBundle({ kind: 'config normal', version: 1 }),
		/"kind".*"config normal"/,
	);
	assert.throws(() => parseSpriteBundle({ version: 1 }), /"kind"/);
	assert.throws(() => parseSpriteBundle('não é objeto'), /objeto/);
	assert.throws(() => parseSpriteBundle(null), /objeto/);
	assert.throws(
		() => parseSpriteBundle({ kind: 'sprite-lab-south', version: 2 }),
		/"version"/,
	);
});

test('parse — lab: rejeita campos ausentes/inválidos nomeando o campo', () => {
	const cases: { name: string; mutate: (b: Record<string, unknown>) => void; re: RegExp }[] = [
		{
			name: 'config ausente',
			mutate: (b) => {
				delete b['config'];
			},
			re: /"config"/,
		},
		{
			name: 'description ausente',
			mutate: (b) => {
				delete (b['config'] as Record<string, unknown>)['description'];
			},
			re: /"config\.description"/,
		},
		{
			name: 'size fora da faixa 32–256',
			mutate: (b) => {
				(b['config'] as Record<string, unknown>)['size'] = 300;
			},
			re: /"config\.size".*32.*256/,
		},
		{
			name: 'view desconhecida',
			mutate: (b) => {
				(b['config'] as Record<string, unknown>)['view'] = 'isometric';
			},
			re: /"config\.view"/,
		},
		{
			name: 'candidates vazio',
			mutate: (b) => {
				b['candidates'] = [];
			},
			re: /"candidates"/,
		},
		{
			name: 'selected.index inexistente em candidates',
			mutate: (b) => {
				(b['selected'] as Record<string, unknown>)['index'] = 9;
			},
			re: /"selected\.index"/,
		},
		{
			name: 'index duplicado em candidates',
			mutate: (b) => {
				((b['candidates'] as Record<string, unknown>[])[1])!['index'] = 0;
			},
			re: /"candidates".*duplicado/,
		},
	];
	for (const c of cases) {
		const bundle = structuredClone(validLabBundle()) as unknown as Record<string, unknown>;
		c.mutate(bundle);
		assert.throws(() => parseSpriteBundle(bundle), c.re, c.name);
	}
});

test('parse — wizard: rejeita campos ausentes/inválidos nomeando o campo', () => {
	const cases: { name: string; mutate: (b: Record<string, unknown>) => void; re: RegExp }[] = [
		{
			name: 'direção obrigatória ausente',
			mutate: (b) => {
				delete (b['directions'] as Record<string, unknown>)['north'];
			},
			re: /directions\["north"\]/,
		},
		{
			name: 'direção desconhecida',
			mutate: (b) => {
				(b['directions'] as Record<string, unknown>)['up'] = b64(makePNG(SIZE, SIZE));
			},
			re: /direção desconhecida: "up"/,
		},
		{
			name: 'frameCount inválido',
			mutate: (b) => {
				(b['config'] as Record<string, unknown>)['frameCount'] = 5;
			},
			re: /"config\.frameCount"/,
		},
		{
			name: 'silhouette desconhecida',
			mutate: (b) => {
				(b['config'] as Record<string, unknown>)['silhouette'] = 'goblin';
			},
			re: /"config\.silhouette"/,
		},
		{
			name: 'south ausente',
			mutate: (b) => {
				delete b['south'];
			},
			re: /"south"/,
		},
		{
			name: 'fps inválido',
			mutate: (b) => {
				(b['config'] as Record<string, unknown>)['fps'] = 0;
			},
			re: /"config\.fps"/,
		},
	];
	for (const c of cases) {
		const bundle = structuredClone(validWizardBundle()) as unknown as Record<string, unknown>;
		c.mutate(bundle);
		assert.throws(() => parseSpriteBundle(bundle), c.re, c.name);
	}
});

test('parse — rejeita PNG inválido (não-PNG e fora da faixa), nomeando o campo', () => {
	const naoPng = b64(Buffer.from('isto não é um png'));
	const grande = b64(makePNG(300, 300));

	const lab = structuredClone(validLabBundle()) as unknown as Record<string, unknown>;
	((lab['candidates'] as Record<string, unknown>[])[0])!['b64'] = naoPng;
	assert.throws(() => parseSpriteBundle(lab), /candidates\[0\]\.b64/);

	const lab2 = structuredClone(validLabBundle()) as unknown as Record<string, unknown>;
	(lab2['selected'] as Record<string, unknown>)['b64'] = grande;
	assert.throws(() => parseSpriteBundle(lab2), /selected\.b64/);

	const wiz = structuredClone(validWizardBundle()) as unknown as Record<string, unknown>;
	(wiz['directions'] as Record<string, unknown>)['south'] = naoPng;
	assert.throws(() => parseSpriteBundle(wiz), /directions\["south"\]/);
});

test('parse — aceita os dois bundles válidos e normaliza a ordem das direções', () => {
	const lab = parseSpriteBundle(validLabBundle());
	assert.equal(lab.kind, 'sprite-lab-south');
	assert.equal(lab.config.size, SIZE);

	const wiz = parseSpriteBundle(validWizardBundle());
	assert.equal(wiz.kind, 'sprite-wizard-directions');
	if (wiz.kind === 'sprite-wizard-directions') {
		assert.deepEqual(Object.keys(wiz.directions), [...DIRECTIONS]);
	}
});

// =====================================================================
// export — pré-condições
// =====================================================================

test('export — exige wizard.etapa "pronto", lock e personagem existente', async () => {
	const dir = tmpDir();
	try {
		const assets = join(dir, 'assets');
		// etapa 'sul' (seedStudio)
		await assert.rejects(
			exportWizardBundle(memoryStore(seedStudio()).store, 'manequim', assets),
			/pronto/,
		);
		// personagem inexistente
		await assert.rejects(
			exportWizardBundle(memoryStore(seedStudio()).store, 'fantasma', assets),
			/fantasma.*não existe/,
		);
		// lock ausente
		const pronto = readyStudioWithFiles(assets);
		const { lock: _drop, ...semLock } = pronto;
		await assert.rejects(
			exportWizardBundle(memoryStore(semLock).store, 'heroi', assets),
			/lock/,
		);
		// célula ausente nomeia a célula
		const semCelula = readyStudioWithFiles(assets);
		delete semCelula.cells[directions8Key('heroi')];
		await assert.rejects(
			exportWizardBundle(memoryStore(semCelula).store, 'heroi', assets),
			/heroi::__directions8__/,
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('export — lê a sul ATIVA via wizard.activeSouth', async () => {
	const dir = tmpDir();
	try {
		const assets = join(dir, 'assets');
		const studio = readyStudioWithFiles(assets);
		// Duas versões da sul em disco; a ativa é a v1.
		writeFileSync(join(assets, 'wizard', 'heroi', 'south-v1.png'), makePNG(SIZE, SIZE, 99));
		const heroi = studio.characters[0]!;
		heroi.wizard = {
			...heroi.wizard!,
			southVersions: [
				{ prompt: 'v0', at: '2026-07-31T00:00:00.000Z' },
				{ prompt: 'v1', at: '2026-07-31T01:00:00.000Z' },
			],
			activeSouth: 1,
		};
		studio.cells[southKey('heroi')] = {
			key: southKey('heroi'),
			status: 'pronto',
			frames: {
				south: ['/assets/wizard/heroi/south-v0.png', '/assets/wizard/heroi/south-v1.png'],
			},
		};

		const bundle = await exportWizardBundle(memoryStore(studio).store, 'heroi', assets);
		assert.equal(bundle.south.b64, b64(makePNG(SIZE, SIZE, 99)), 'sul ativa (v1)');
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

// =====================================================================
// roundtrip export → parse → import
// =====================================================================

test('roundtrip — export→parse→import (alvo new) reproduz personagem, células e bytes', async () => {
	const dir = tmpDir();
	try {
		const srcAssets = join(dir, 'src-assets');
		const dstAssets = join(dir, 'dst-assets');

		const exported = await exportWizardBundle(
			memoryStore(readyStudioWithFiles(srcAssets)).store,
			'heroi',
			srcAssets,
		);
		// O export TEM que passar no parse — é o contrato entre os dois lados.
		const bundle = parseSpriteBundle(JSON.parse(JSON.stringify(exported)));
		assert.equal(bundle.kind, 'sprite-wizard-directions');

		const { store, saves, current } = memoryStore(seedStudio());
		const { characterId } = await importSpriteBundle(
			store,
			bundle,
			{ kind: 'new', label: 'Herói' },
			dstAssets,
		);
		assert.equal(characterId, 'heroi', 'id = slug do label');
		assert.equal(saves.length, 1, 'um único save');

		const saved = current();
		const ch = saved.characters.find((c) => c.id === 'heroi')!;
		assert.equal(ch.description, 'grey hero, bald');
		assert.equal(ch.size, SIZE);
		assert.equal(ch.seed, 42);
		assert.equal(ch.silhouette, 'humano-esguio');
		assert.equal(ch.remoteId, 'char-remote-123');
		assert.equal(ch.wizard?.etapa, 'pronto');
		assert.deepEqual(ch.wizard?.southVersions, [
			{ prompt: 'grey hero, bald', at: bundle.exportedAt },
		]);
		assert.equal(ch.wizard?.activeSouth, 0);
		assert.ok(typeof ch.createdAt === 'string' && ch.createdAt.length > 0);

		// lock travado a partir do bundle
		assert.deepEqual(saved.lock, { ...LOCK });
		// manequim do seed preservado
		assert.ok(saved.characters.some((c) => c.id === 'manequim'));

		// células prontas
		assert.equal(saved.cells[southKey('heroi')]?.status, 'pronto');
		assert.deepEqual(saved.cells[southKey('heroi')]?.frames, {
			south: ['/assets/wizard/heroi/south-v0.png'],
		});
		const dir8 = saved.cells[directions8Key('heroi')];
		assert.equal(dir8?.status, 'pronto');
		assert.deepEqual(Object.keys(dir8?.frames ?? {}), [...DIRECTIONS]);
		for (const d of DIRECTIONS) {
			assert.deepEqual(dir8?.frames?.[d], [`/assets/wizard/${safe8('heroi')}/${d}-00.png`]);
		}

		// bytes exatos no disco
		assert.deepEqual(
			readFileSync(join(dstAssets, 'wizard', 'heroi', 'south-v0.png')),
			makePNG(SIZE, SIZE, SOUTH_FILL),
		);
		for (const d of DIRECTIONS) {
			assert.deepEqual(
				readFileSync(join(dstAssets, 'wizard', safe8('heroi'), `${d}-00.png`)),
				makePNG(SIZE, SIZE, DIR_FILLS[d]!),
				`bytes de ${d}`,
			);
		}
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

// =====================================================================
// import — lab vs wizard
// =====================================================================

test('import — lab: etapa direcoes8, remoteId removido, direções velhas apagadas', async () => {
	const dir = tmpDir();
	try {
		const assets = join(dir, 'assets');
		const studio = seedStudio();
		// remoteId velho + descrição velha: o import de lab remove um e troca a outra
		studio.characters[0] = {
			...studio.characters[0]!,
			remoteId: 'char-remoto-velho',
			description: 'descrição velha',
		};
		// direções de uma sul anterior — precisam sumir com o import de lab
		studio.cells[directions8Key('manequim')] = {
			key: directions8Key('manequim'),
			status: 'pronto',
			frames: Object.fromEntries(DIRECTIONS.map((d) => [d, ['/assets/velho.png']])),
		};
		const { store, current } = memoryStore(studio);
		const bundle = parseSpriteBundle(validLabBundle());

		const { characterId } = await importSpriteBundle(
			store,
			bundle,
			{ kind: 'existing', characterId: 'manequim' },
			assets,
		);
		assert.equal(characterId, 'manequim');

		const saved = current();
		const ch = saved.characters.find((c) => c.id === 'manequim')!;
		assert.equal(ch.wizard?.etapa, 'direcoes8');
		assert.deepEqual(ch.wizard?.southVersions, [
			{ prompt: 'armored knight, heavy plate', at: '2026-08-01T13:00:00.000Z' },
		]);
		assert.equal(ch.wizard?.activeSouth, 0);
		assert.equal(ch.description, 'armored knight, heavy plate');
		assert.equal(ch.size, SIZE);
		assert.equal(ch.seed, 5);
		assert.equal(ch.remoteId, undefined, 'remoteId anterior removido — a sul mudou');
		assert.equal(
			saved.cells[directions8Key('manequim')],
			undefined,
			'direções da sul anterior apagadas',
		);
		assert.equal(saved.cells[southKey('manequim')]?.status, 'pronto');
		assert.deepEqual(saved.cells[southKey('manequim')]?.frames, {
			south: ['/assets/wizard/manequim/south-v0.png'],
		});

		// a sul gravada é a do candidato SELECIONADO (fill 51)
		assert.deepEqual(
			readFileSync(join(assets, 'wizard', 'manequim', 'south-v0.png')),
			makePNG(SIZE, SIZE, 51),
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('import — wizard: etapa pronto + remoteId do bundle (e removido quando ausente)', async () => {
	const dir = tmpDir();
	try {
		const assets = join(dir, 'assets');
		const { store, current } = memoryStore(seedStudio());
		await importSpriteBundle(
			store,
			parseSpriteBundle(validWizardBundle()),
			{ kind: 'existing', characterId: 'manequim' },
			assets,
		);
		let ch = current().characters.find((c) => c.id === 'manequim')!;
		assert.equal(ch.wizard?.etapa, 'pronto');
		assert.equal(ch.remoteId, 'char-remote-999');
		assert.equal(current().cells[directions8Key('manequim')]?.status, 'pronto');

		// bundle SEM remoteId: o id remoto anterior não sobrevive ao import
		const semRemote = structuredClone(validWizardBundle()) as unknown as Record<string, unknown>;
		delete semRemote['remoteId'];
		const store2 = memoryStore(seedStudio());
		await importSpriteBundle(
			store2.store,
			parseSpriteBundle(semRemote),
			{ kind: 'existing', characterId: 'manequim' },
			join(dir, 'assets2'),
		);
		ch = store2.current().characters.find((c) => c.id === 'manequim')!;
		assert.equal(ch.remoteId, undefined);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

// =====================================================================
// import — regras do lock
// =====================================================================

test('import — lock ausente: lab trava 8/8, wizard trava os valores do bundle', async () => {
	const dir = tmpDir();
	try {
		// lab: sem frameCount/fps no bundle → defaults 8/8
		const m1 = memoryStore(seedStudio());
		await importSpriteBundle(
			m1.store,
			parseSpriteBundle(validLabBundle()),
			{ kind: 'existing', characterId: 'manequim' },
			join(dir, 'a1'),
		);
		assert.deepEqual(m1.current().lock, { frameCount: 8, fps: 8, size: SIZE });

		// wizard: frameCount/fps do bundle
		const wiz = structuredClone(validWizardBundle()) as unknown as Record<string, unknown>;
		(wiz['config'] as Record<string, unknown>)['frameCount'] = 16;
		(wiz['config'] as Record<string, unknown>)['fps'] = 12;
		const m2 = memoryStore(seedStudio());
		await importSpriteBundle(
			m2.store,
			parseSpriteBundle(wiz),
			{ kind: 'existing', characterId: 'manequim' },
			join(dir, 'a2'),
		);
		assert.deepEqual(m2.current().lock, { frameCount: 16, fps: 12, size: SIZE });
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('import — lock presente com size divergente é erro em pt-BR, sem gravar nada', async () => {
	const dir = tmpDir();
	try {
		const assets = join(dir, 'assets');
		const studio = seedStudio();
		studio.lock = { frameCount: 8, fps: 8, size: 128 }; // bundle tem size 64
		const { store, saves } = memoryStore(studio);
		await assert.rejects(
			importSpriteBundle(
				store,
				parseSpriteBundle(validWizardBundle()),
				{ kind: 'existing', characterId: 'manequim' },
				assets,
			),
			/size do bundle \(64\) não bate com o lock do studio \(128\)/,
		);
		assertNothingWritten(saves, assets, 'manequim');
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('import — lock presente com size igual é preservado (campos extras intactos)', async () => {
	const dir = tmpDir();
	try {
		const assets = join(dir, 'assets');
		const studio = seedStudio();
		studio.lock = { frameCount: 4, fps: 6, size: SIZE, view: 'high top-down', templateId: 'cat' };
		const { store, current } = memoryStore(studio);
		await importSpriteBundle(
			store,
			parseSpriteBundle(validWizardBundle()),
			{ kind: 'existing', characterId: 'manequim' },
			assets,
		);
		assert.deepEqual(current().lock, {
			frameCount: 4,
			fps: 6,
			size: SIZE,
			view: 'high top-down',
			templateId: 'cat',
		});
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

// =====================================================================
// import — alvos
// =====================================================================

test('import — alvo new: conflito de slug é erro; lab herda silhueta do manequim', async () => {
	const dir = tmpDir();
	try {
		const assets = join(dir, 'assets');

		// conflito: 'Manequim base' → slug 'manequim-base'; pré-cria o id
		const studio = seedStudio();
		studio.characters.push({
			id: 'cavaleiro',
			label: 'Cavaleiro',
			silhouette: 'humano-medio',
			description: 'x',
			size: SIZE,
			seed: 1,
			wizard: { etapa: 'sul', southVersions: [], activeSouth: 0 },
			createdAt: '2026-07-31T00:00:00.000Z',
		});
		const { store, saves } = memoryStore(studio);
		await assert.rejects(
			importSpriteBundle(
				store,
				parseSpriteBundle(validLabBundle()),
				{ kind: 'new', label: 'Cavaleiro' },
				assets,
			),
			/já existe um personagem com o id "cavaleiro"/,
		);
		assertNothingWritten(saves, assets, 'cavaleiro');

		// lab: sem silhueta no bundle → herda a do manequim
		const studio2 = seedStudio();
		studio2.characters[0] = { ...studio2.characters[0]!, silhouette: 'quadrupede' };
		const m2 = memoryStore(studio2);
		const { characterId } = await importSpriteBundle(
			m2.store,
			parseSpriteBundle(validLabBundle()),
			{ kind: 'new', label: 'Herói da Vila' },
			assets,
		);
		assert.equal(characterId, 'heroi-da-vila', 'slug remove acentos e espaços');
		const ch = m2.current().characters.find((c) => c.id === 'heroi-da-vila')!;
		assert.equal(ch.silhouette, 'quadrupede', 'silhueta herdada do manequim');
		assert.equal(ch.label, 'Herói da Vila');
		assert.equal(ch.wizard?.etapa, 'direcoes8');
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('import — alvo new com bundle do wizard usa a silhueta do bundle', async () => {
	const dir = tmpDir();
	try {
		const assets = join(dir, 'assets');
		const m = memoryStore(seedStudio());
		const { characterId } = await importSpriteBundle(
			m.store,
			parseSpriteBundle(validWizardBundle()),
			{ kind: 'new', label: 'Guarda' },
			assets,
		);
		const ch = m.current().characters.find((c) => c.id === characterId)!;
		assert.equal(ch.silhouette, 'humano-medio', 'silhueta do bundle, não a do manequim');
		assert.equal(ch.wizard?.etapa, 'pronto');
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('import — alvo existing exige personagem com wizard state', async () => {
	const dir = tmpDir();
	try {
		const assets = join(dir, 'assets');

		// inexistente
		const m1 = memoryStore(seedStudio());
		await assert.rejects(
			importSpriteBundle(
				m1.store,
				parseSpriteBundle(validLabBundle()),
				{ kind: 'existing', characterId: 'fantasma' },
				assets,
			),
			/personagem "fantasma" não encontrado/,
		);
		assertNothingWritten(m1.saves, assets, 'fantasma');

		// sem wizard state
		const studio = seedStudio();
		studio.characters.push({
			id: 'legado',
			label: 'Legado',
			silhouette: 'humano-medio',
			description: 'x',
			size: SIZE,
			seed: 1,
			createdAt: '2026-07-31T00:00:00.000Z',
		});
		const m2 = memoryStore(studio);
		await assert.rejects(
			importSpriteBundle(
				m2.store,
				parseSpriteBundle(validLabBundle()),
				{ kind: 'existing', characterId: 'legado' },
				assets,
			),
			/não está no fluxo do wizard/,
		);
		assertNothingWritten(m2.saves, assets, 'legado');
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

// =====================================================================
// import — idempotência
// =====================================================================

test('import — reimportar o mesmo bundle no mesmo alvo produz as mesmas escritas', async () => {
	const dir = tmpDir();
	try {
		const assets = join(dir, 'assets');
		const bundle = parseSpriteBundle(validWizardBundle());
		const target = { kind: 'existing', characterId: 'manequim' } as const;
		// A MESMA semente dos dois lados. Chamar `seedStudio()` de novo para ler o
		// `createdAt` esperado dependia do relógio: o campo é `new Date()
		// .toISOString()`, e quando o milissegundo virava entre as duas chamadas o
		// teste falhava por 1 ms. Reproduzido em ~1 de 25 execuções deste arquivo,
		// e nada tem a ver com o que ele mede.
		const semente = seedStudio();
		const { store, saves, current } = memoryStore(semente);
		const createdAtAntes = semente.characters[0]!.createdAt;

		await importSpriteBundle(store, bundle, target, assets);
		const first = current();
		const firstBytes = readFileSync(join(assets, 'wizard', 'manequim', 'south-v0.png'));

		await importSpriteBundle(store, bundle, target, assets);
		assert.equal(saves.length, 2);
		assert.deepEqual(current(), first, 'studio da 2ª importação é idêntico ao da 1ª');
		assert.equal(
			current().characters.find((c) => c.id === 'manequim')!.createdAt,
			createdAtAntes,
			'createdAt do alvo existing preservado',
		);
		assert.deepEqual(
			readFileSync(join(assets, 'wizard', 'manequim', 'south-v0.png')),
			firstBytes,
			'PNGs regravados com os mesmos bytes',
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
