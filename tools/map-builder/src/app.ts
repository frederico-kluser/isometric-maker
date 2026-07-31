/**
 * Aplicação do Map Builder — F2-05.
 *
 * Inicialização assíncrona, ticker separado do relógio de lógica,
 * renderização do mapa de fixture.
 *
 * ## Regras
 *
 * - NENHUMA edição neste módulo.  Apenas visualização.
 * - Ticker do PixiJS é separado do relógio de lógica.
 * - Teardown completo no `destroy()`.
 */

import { createMapRenderer, type MapRenderer } from "./renderer.ts";
import type { MapData } from "@isometric-maker/iso-core/map";

/** Geometria da projecção isométrica (evita importar project.ts que usa node:crypto). */
interface ProjectGeometry {
	readonly tileWidth: number;
	readonly tileHeight: number;
	readonly zStep: number;
}

// ------------------------------------------------------------------ fixture

/**
 * Mapa de teste — um terreno 3×3 com alguns blocos e paredes.
 */
const FIXTURE_MAP: MapData = {
	blocks: {
		"0:0": [
			{ block: "grass", count: 2 },
			{ block: "dirt", count: 1 },
		],
		"1:0": [
			{ block: "grass", count: 1 },
			{ block: "stone", count: 1 },
		],
		"2:0": [{ block: "grass", count: 3 }],
		"0:1": [{ block: "grass", count: 1 }],
		"1:1": [
			{ block: "grass", count: 2 },
			{ block: "dirt", count: 2 },
		],
		"2:1": [
			{ block: "grass", count: 1 },
			{ block: "stone", count: 1 },
		],
		"0:2": [{ block: "grass", count: 1 }],
		"1:2": [{ block: "grass", count: 1 }],
		"2:2": [{ block: "grass", count: 2 }],
	},
	edges: [
		{ x: 0, y: 0, z: 0, lado: "L", tipo: "stone_wall" },
		{ x: 1, y: 0, z: 0, lado: "N", tipo: "stone_wall" },
		{ x: 1, y: 1, z: 1, lado: "L", tipo: "wood_wall" },
	],
};

// ------------------------------------------------------------------ geometria

const GEOMETRY: ProjectGeometry = {
	tileWidth: 64,
	tileHeight: 32,
	zStep: 16,
};

// ------------------------------------------------------------------ main

async function main(): Promise<void> {
	// Encontra ou cria o canvas
	let canvas = document.querySelector("canvas") as HTMLCanvasElement | null;
	if (!canvas) {
		canvas = document.createElement("canvas");
		canvas.width = window.innerWidth;
		canvas.height = window.innerHeight;
		document.body.append(canvas);
	}

	// Cria o renderizador
	const renderer: MapRenderer = await createMapRenderer(canvas, {
		geometry: GEOMETRY,
		stageScale: 2, // inteiro
		cameraOffset: { x: canvas.width / 2, y: 100 },
		backgroundColor: 0x1a1a2e,
	});

	// Render inicial
	renderer.render(FIXTURE_MAP);

	// --- Ticker de desenho (separado da lógica) ---
	// O ticker do PixiJS renderiza o stage automaticamente.
	// Não usamos o ticker para lógica — apenas para desenho.

	// --- Resize ---
	const onResize = (): void => {
		canvas.width = window.innerWidth;
		canvas.height = window.innerHeight;
		renderer.render(FIXTURE_MAP);
	};
	window.addEventListener("resize", onResize);

	// --- Teardown no unload ---
	const onUnload = (): void => {
		window.removeEventListener("resize", onResize);
		renderer.destroy();
	};
	window.addEventListener("beforeunload", onUnload);

	// Renderizador pronto. Log de inicialização mantido para diagnóstico.
	console.log("Map Builder iniciado. Mapa de fixture renderizado.");
}

// --- Arranque ---
main().catch((err) => {
	console.error("Falha ao iniciar Map Builder:", err);
});
