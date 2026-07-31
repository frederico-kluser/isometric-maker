/**
 * Testes de server/mannequin-io.ts — export/import do manequim default.
 *
 * Sem rede, sem API: studios em memória (StudioStoreLike falso), PNGs
 * sintéticos gerados em disco (mesmo padrão de src/import.test.ts) e
 * diretórios temporários (padrão de idempotence.test.ts).
 *
 * Propriedades verificadas:
 *   1. export exige wizard.etapa 'pronto' e lock presente;
 *   2. export grava o layout completo (mannequin.json + 12 PNGs) e devolve
 *      o bundle equivalente em memória;
 *   3. roundtrip export→import reproduz células 'pronto', lock, paleta e
 *      personagem, com os mesmos bytes de PNG;
 *   4. import é idempotente (mesmo bundle, mesmas escritas);
 *   5. import rejeita bundle inválido (frameCount, dimensão de PNG, direção
 *      ausente, schema) SEM gravar nada;
 *   6. readDefaultBundle é null silencioso para ausente/inválido.
 *
 * Execute com: node --test server/mannequin-io.test.ts
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
	cardinalKey,
	directions8Key,
	seedStudio,
	southKey,
	type Character,
	type Studio,
} from './model.ts';
import {
	exportMannequin,
	importMannequin,
	readDefaultBundle,
	type MannequinBundle,
	type StudioStoreLike,
} from './mannequin-io.ts';

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

/**
 * PNG RGB 8bpc válido com as dimensões dadas. `fill` preenche os pixels para
 * que arquivos diferentes tenham bytes diferentes — é o que permite detectar
 * troca de arquivos no roundtrip. A validação só lê assinatura + IHDR.
 */
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

// =====================================================================
// fixtures — diretórios temporários e store em memória
// =====================================================================

function tmpDir(): string {
	const dir = join(tmpdir(), `mannequin-io-test-${randomBytes(4).toString('hex')}`);
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

// =====================================================================
// fixtures — studio com manequim pronto + PNGs em disco
// =====================================================================

const SIZE = 64;
const LOCK = { frameCount: 8, fps: 8, size: SIZE } as const;

/** fill byte de cada arquivo do bundle, para bytes distinguíveis. */
const FILLS: Record<string, number> = {
	'south.png': 10,
	'cardinal-east.png': 20,
	'cardinal-north.png': 21,
	'cardinal-west.png': 22,
	'directions/south.png': 30,
	'directions/south-west.png': 31,
	'directions/west.png': 32,
	'directions/north-west.png': 33,
	'directions/north.png': 34,
	'directions/north-east.png': 35,
	'directions/east.png': 36,
	'directions/south-east.png': 37,
};

/**
 * Grava os 12 PNGs de fixture em `srcAssets/wizard/…` e devolve um studio v2
 * com o manequim pronto cujas células apontam para eles.
 */
function readyStudioWithFiles(srcAssets: string): Studio {
	const wizardDir = join(srcAssets, 'wizard');
	mkdirSync(join(wizardDir, 'directions'), { recursive: true });
	for (const [name, fill] of Object.entries(FILLS)) {
		writeFileSync(join(wizardDir, name), makePNG(SIZE, SIZE, fill));
	}

	const base = seedStudio();
	const mannequin: Character = {
		...base.characters[0]!,
		description: 'bald naked humanoid mannequin, grey skin',
		size: SIZE,
		seed: 42,
		silhouette: 'humano-esguio',
		remoteId: 'char-remote-123',
		wizard: {
			etapa: 'pronto',
			southVersions: [{ prompt: 'grey mannequin', at: '2026-07-31T00:00:00.000Z' }],
			activeSouth: 0,
		},
	};

	const url = (name: string): string => `/assets/wizard/${name}`;
	return {
		...base,
		lock: { ...LOCK },
		characters: [mannequin],
		cells: {
			[southKey('manequim')]: {
				key: southKey('manequim'),
				status: 'pronto',
				frames: { south: [url('south.png')] },
			},
			[cardinalKey('manequim', 'east')]: {
				key: cardinalKey('manequim', 'east'),
				status: 'pronto',
				frames: { east: [url('cardinal-east.png')] },
			},
			[cardinalKey('manequim', 'north')]: {
				key: cardinalKey('manequim', 'north'),
				status: 'pronto',
				frames: { north: [url('cardinal-north.png')] },
			},
			[cardinalKey('manequim', 'west')]: {
				key: cardinalKey('manequim', 'west'),
				status: 'pronto',
				frames: { west: [url('cardinal-west.png')] },
			},
			[directions8Key('manequim')]: {
				key: directions8Key('manequim'),
				status: 'pronto',
				frames: Object.fromEntries(
					DIRECTIONS.map((d) => [d, [url(`directions/${d}.png`)]]),
				),
			},
		},
	};
}

/** Bundle válido construído em memória (sem passar pelo export). */
function validBundle(): MannequinBundle {
	return {
		manifest: {
			version: 2,
			description: 'bald naked humanoid mannequin, grey skin',
			size: SIZE,
			seed: 7,
			silhouette: 'humano-medio',
			lock: { ...LOCK },
			palette: ['#0d0b0e', '#eae6ea'],
			remoteId: 'char-remote-999',
			exportedAt: '2026-07-31T12:00:00.000Z',
		},
		files: Object.entries(FILLS).map(([name, fill]) => ({
			name,
			b64: makePNG(SIZE, SIZE, fill).toString('base64'),
		})),
	};
}

/** Confere que nada foi gravado: nem save, nem arquivo em assetsDir. */
function assertNothingWritten(saves: Studio[], assetsDir: string): void {
	assert.equal(saves.length, 0, 'store.save não deveria ter sido chamado');
	assert.equal(
		existsSync(join(assetsDir, 'manequim')),
		false,
		'nenhum PNG deveria ter sido copiado',
	);
}

// =====================================================================
// export — pré-condições
// =====================================================================

test('export — exige wizard.etapa "pronto"', async () => {
	const dir = tmpDir();
	try {
		const { store, saves } = memoryStore(seedStudio()); // etapa 'sul'
		await assert.rejects(
			exportMannequin(store, join(dir, 'out'), dir),
			/pronto/,
		);
		assert.equal(saves.length, 0, 'export não deveria salvar o studio');
		assert.equal(existsSync(join(dir, 'out')), false, 'nada deveria ser gravado');
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('export — exige lock presente', async () => {
	const dir = tmpDir();
	try {
		const studio = readyStudioWithFiles(join(dir, 'assets'));
		const { lock: _drop, ...semLock } = studio;
		await assert.rejects(
			exportMannequin(memoryStore(semLock).store, join(dir, 'out'), join(dir, 'assets')),
			/lock/,
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('export — célula do wizard ausente é erro nomeado', async () => {
	const dir = tmpDir();
	try {
		const studio = readyStudioWithFiles(join(dir, 'assets'));
		delete studio.cells[cardinalKey('manequim', 'east')];
		await assert.rejects(
			exportMannequin(memoryStore(studio).store, join(dir, 'out'), join(dir, 'assets')),
			/manequim::__cardinal-east__/,
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

// =====================================================================
// export — layout completo
// =====================================================================

test('export — grava mannequin.json + 12 PNGs e devolve o bundle', async () => {
	const dir = tmpDir();
	try {
		const srcAssets = join(dir, 'assets');
		const targetDir = join(dir, 'export');
		const { store } = memoryStore(readyStudioWithFiles(srcAssets));

		const bundle = await exportMannequin(store, targetDir, srcAssets);

		// manifest em memória
		assert.equal(bundle.manifest.version, 2);
		assert.equal(bundle.manifest.description, 'bald naked humanoid mannequin, grey skin');
		assert.equal(bundle.manifest.size, SIZE);
		assert.equal(bundle.manifest.seed, 42);
		assert.equal(bundle.manifest.silhouette, 'humano-esguio');
		assert.deepEqual(bundle.manifest.lock, { ...LOCK });
		assert.deepEqual(bundle.manifest.palette, seedStudio().palette);
		assert.equal(bundle.manifest.remoteId, 'char-remote-123');
		assert.equal(typeof bundle.manifest.exportedAt, 'string');
		assert.equal(bundle.files.length, 12);

		// mannequin.json no disco bate com o manifest em memória
		const onDisk = JSON.parse(
			readFileSync(join(targetDir, 'mannequin.json'), 'utf8'),
		) as unknown;
		assert.deepEqual(onDisk, bundle.manifest);

		// os 12 PNGs estão no disco com os bytes exatos das fixtures
		for (const [name, fill] of Object.entries(FILLS)) {
			const expected = makePNG(SIZE, SIZE, fill);
			assert.ok(existsSync(join(targetDir, name)), `faltando ${name}`);
			assert.deepEqual(readFileSync(join(targetDir, name)), expected, `bytes de ${name}`);
		}
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

// =====================================================================
// roundtrip export → import
// =====================================================================

test('roundtrip — export→import reproduz células prontas, lock e personagem', async () => {
	const dir = tmpDir();
	try {
		const srcAssets = join(dir, 'src-assets');
		const dstAssets = join(dir, 'dst-assets');
		const bundle = await exportMannequin(
			memoryStore(readyStudioWithFiles(srcAssets)).store,
			join(dir, 'export'),
			srcAssets,
		);

		// studio de destino: novo, com outro personagem e célula dele preservados
		const fresh = seedStudio();
		fresh.characters.push({
			id: 'guarda',
			label: 'Guarda',
			silhouette: 'humano-medio',
			description: 'city guard',
			size: SIZE,
			seed: 5,
			createdAt: '2026-07-31T00:00:00.000Z',
		});
		fresh.cells['guarda::__base__'] = { key: 'guarda::__base__', status: 'gerando' };
		const { store, saves, current } = memoryStore(fresh);

		await importMannequin(store, { kind: 'bundle', bundle }, dstAssets);

		assert.equal(saves.length, 1, 'um único save');
		const saved = current();

		// lock e paleta do manifest
		assert.deepEqual(saved.lock, { ...LOCK });
		assert.deepEqual(saved.palette, seedStudio().palette);

		// manequim recriado, demais personagens preservados
		assert.deepEqual(
			saved.characters.map((c) => c.id),
			['manequim', 'guarda'],
		);
		const m = saved.characters[0]!;
		assert.equal(m.description, 'bald naked humanoid mannequin, grey skin');
		assert.equal(m.size, SIZE);
		assert.equal(m.seed, 42);
		assert.equal(m.silhouette, 'humano-esguio');
		assert.equal(m.remoteId, 'char-remote-123');
		assert.equal(m.wizard?.etapa, 'pronto');

		// célula alheia preservada
		assert.equal(saved.cells['guarda::__base__']?.status, 'gerando');

		// 5 células do wizard prontas, apontando para assets/manequim/
		assert.equal(saved.cells[southKey('manequim')]?.status, 'pronto');
		assert.deepEqual(saved.cells[southKey('manequim')]?.frames, {
			south: ['/assets/manequim/south.png'],
		});
		for (const d of ['east', 'north', 'west'] as const) {
			const cell = saved.cells[cardinalKey('manequim', d)];
			assert.equal(cell?.status, 'pronto', `cardeal ${d}`);
			assert.deepEqual(cell?.frames, { [d]: [`/assets/manequim/cardinal-${d}.png`] });
		}
		const dir8 = saved.cells[directions8Key('manequim')];
		assert.equal(dir8?.status, 'pronto');
		assert.deepEqual(Object.keys(dir8?.frames ?? {}), [...DIRECTIONS]);
		for (const d of DIRECTIONS) {
			assert.deepEqual(dir8?.frames?.[d], [`/assets/manequim/directions/${d}.png`]);
		}

		// PNGs copiados com os mesmos bytes
		for (const [name, fill] of Object.entries(FILLS)) {
			assert.deepEqual(
				readFileSync(join(dstAssets, 'manequim', name)),
				makePNG(SIZE, SIZE, fill),
				`bytes de ${name}`,
			);
		}
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('import — reimportar o mesmo bundle produz as mesmas escritas', async () => {
	const dir = tmpDir();
	try {
		const dstAssets = join(dir, 'assets');
		const bundle = validBundle();
		const { store, saves, current } = memoryStore(seedStudio());

		await importMannequin(store, { kind: 'bundle', bundle }, dstAssets);
		const first = current();
		const firstBytes = readFileSync(join(dstAssets, 'manequim', 'south.png'));

		await importMannequin(store, { kind: 'bundle', bundle }, dstAssets);
		assert.equal(saves.length, 2);
		assert.deepEqual(current(), first, 'studio da 2ª importação é idêntico ao da 1ª');
		assert.deepEqual(
			readFileSync(join(dstAssets, 'manequim', 'south.png')),
			firstBytes,
			'PNGs regravados com os mesmos bytes',
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

// =====================================================================
// import — rejeições sem gravar nada
// =====================================================================

test('import — rejeita schema inválido (version, size, silhouette, frameCount, palette)', async () => {
	const dir = tmpDir();
	try {
		const dstAssets = join(dir, 'assets');
		const cases: { name: string; mutate: (b: MannequinBundle) => void; re: RegExp }[] = [
			{
				name: 'version errada',
				mutate: (b) => {
					(b.manifest as { version: number }).version = 1;
				},
				re: /version/,
			},
			{
				name: 'size fora da faixa do /rotate',
				mutate: (b) => {
					(b.manifest as { size: number }).size = 300;
				},
				re: /size/,
			},
			{
				name: 'silhouette desconhecida',
				mutate: (b) => {
					(b.manifest as { silhouette: string }).silhouette = 'goblin';
				},
				re: /silhouette/,
			},
			{
				name: 'frameCount inválido',
				mutate: (b) => {
					(b.manifest.lock as { frameCount: number }).frameCount = 5;
				},
				re: /frameCount/,
			},
			{
				name: 'palette vazia',
				mutate: (b) => {
					(b.manifest as { palette: readonly string[] }).palette = [];
				},
				re: /palette/,
			},
		];
		for (const c of cases) {
			const bundle = structuredClone(validBundle());
			c.mutate(bundle);
			const { store, saves } = memoryStore(seedStudio());
			await assert.rejects(
				importMannequin(store, { kind: 'bundle', bundle }, dstAssets),
				c.re,
				c.name,
			);
			assertNothingWritten(saves, dstAssets);
		}
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('import — rejeita PNG com dimensão errada, sem gravar nada', async () => {
	const dir = tmpDir();
	try {
		const dstAssets = join(dir, 'assets');
		const bundle = structuredClone(validBundle());
		const north = bundle.files.find((f) => f.name === 'directions/north.png')!;
		(north as { b64: string }).b64 = makePNG(32, 32).toString('base64');

		const { store, saves } = memoryStore(seedStudio());
		await assert.rejects(
			importMannequin(store, { kind: 'bundle', bundle }, dstAssets),
			/directions\/north\.png.*32×32.*64×64/,
		);
		assertNothingWritten(saves, dstAssets);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('import — rejeita direção faltando, sem gravar nada', async () => {
	const dir = tmpDir();
	try {
		const dstAssets = join(dir, 'assets');
		const bundle = structuredClone(validBundle());
		const files = bundle.files.filter((f) => f.name !== 'directions/north.png');
		(bundle as { files: unknown }).files = files;

		const { store, saves } = memoryStore(seedStudio());
		await assert.rejects(
			importMannequin(store, { kind: 'bundle', bundle }, dstAssets),
			/directions\/north\.png.*obrigatória/,
		);
		assertNothingWritten(saves, dstAssets);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

// =====================================================================
// readDefaultBundle + import kind 'default'
// =====================================================================

test('readDefaultBundle — null para diretório inexistente', async () => {
	const dir = join(tmpdir(), `mannequin-io-test-${randomBytes(4).toString('hex')}`);
	assert.equal(await readDefaultBundle(dir), null);
});

test('readDefaultBundle — null para conteúdo inválido', async () => {
	const dir = tmpDir();
	try {
		// mannequin.json quebrado
		writeFileSync(join(dir, 'mannequin.json'), '{ isso não é json');
		assert.equal(await readDefaultBundle(dir), null);

		// manifest válido, mas faltam os PNGs
		writeFileSync(
			join(dir, 'mannequin.json'),
			JSON.stringify(validBundle().manifest),
		);
		assert.equal(await readDefaultBundle(dir), null);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('readDefaultBundle — devolve bundle de um export válido', async () => {
	const dir = tmpDir();
	try {
		const srcAssets = join(dir, 'assets');
		const targetDir = join(dir, 'export');
		const exported = await exportMannequin(
			memoryStore(readyStudioWithFiles(srcAssets)).store,
			targetDir,
			srcAssets,
		);

		const bundle = await readDefaultBundle(targetDir);
		assert.ok(bundle, 'bundle deveria ser lido');
		assert.deepEqual(bundle.manifest, exported.manifest);
		assert.equal(bundle.files.length, 12);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('import kind "default" — lê do diretório e nomeia erro quando ausente', async () => {
	const dir = tmpDir();
	try {
		const srcAssets = join(dir, 'src-assets');
		const targetDir = join(dir, 'export');
		await exportMannequin(
			memoryStore(readyStudioWithFiles(srcAssets)).store,
			targetDir,
			srcAssets,
		);

		// caminho feliz
		const dstAssets = join(dir, 'dst-assets');
		const { store, saves, current } = memoryStore(seedStudio());
		await importMannequin(store, { kind: 'default', defaultDir: targetDir }, dstAssets);
		assert.equal(saves.length, 1);
		assert.equal(current().cells[directions8Key('manequim')]?.status, 'pronto');
		assert.ok(existsSync(join(dstAssets, 'manequim', 'directions', 'north.png')));

		// diretório inexistente: erro nomeado, nada gravado
		const missing = memoryStore(seedStudio());
		await assert.rejects(
			importMannequin(
				missing.store,
				{ kind: 'default', defaultDir: join(dir, 'nao-existe') },
				dstAssets,
			),
			/default indisponível/,
		);
		assert.equal(missing.saves.length, 0);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
