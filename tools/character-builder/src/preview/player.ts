/**
 * Player de prévia com scrubber e rosa dos ventos — F1-08.
 *
 * Renderiza uma animação de personagem usando PixiJS 8.
 * Controlos: play/pause, scrubber por quadro, fps editável,
 * seletor de ação, rosa dos ventos (via compass.ts).
 *
 * ## Regras
 *
 * - `TextureSource.defaultOptions.scaleMode = 'nearest'` e
 *   `autoGenerateMipmaps = false` ANTES do primeiro `Assets.load`.
 * - Escala do palco INTEIRA (sem subpíxeis).
 * - fps NÃO vive no JSON do Pixi — vive no sidecar .pixellab.json.
 * - `animationSpeed = fps / 60`, não fps.
 * - Âncora vinda do sidecar. Se `anchorSource` for `'padrao'`, mostre aviso.
 */

import {
	Application,
	Container,
	AnimatedSprite,
	type Texture,
	Assets,
	TextureSource,
} from "pixi.js";

// ------------------------------------------------------------------ tipos

/** Metadados do sidecar .pixellab.json */
export interface SidecarData {
	/** Frames por segundo da animação. */
	readonly fps: number;
	/** Número de frames. */
	readonly frameCount: number;
	/** Origem da âncora: 'padrao' (API) ou 'custom' (definida pelo editor). */
	readonly anchorSource?: "padrao" | "custom";
	/** Ponto de ancoragem (0..1). */
	readonly anchor?: { readonly x: number; readonly y: number };
	/** Largura do frame em píxeis. */
	readonly frameWidth?: number;
	/** Altura do frame em píxeis. */
	readonly frameHeight?: number;
}

/** Uma ação disponível para pré-visualização. */
export interface PreviewAction {
	readonly id: string;
	readonly label: string;
	/** Atlas ou spritesheet URL. */
	readonly atlasUrl: string;
	/** Sidecar com metadados. */
	readonly sidecar: SidecarData;
	/** Frames por direcção. Key = direcção (ex.: 'south'), value = array de URLs ou índices. */
	readonly framesByDirection: Record<string, string[]>;
}

// ------------------------------------------------------------------ configuração

export interface PlayerConfig {
	/** Elemento canvas a usar (se omitido, cria um). */
	readonly canvas?: HTMLCanvasElement;
	/** Largura do viewport. */
	readonly width: number;
	/** Altura do viewport. */
	readonly height: number;
	/** Cor de fundo (hex). */
	readonly backgroundColor?: number;
	/** Escala do palco (INTEIRA, ex.: 1, 2, 3). */
	readonly scale?: number;
}

// ------------------------------------------------------------------ player

export interface PlayerControl {
	/** Elemento canvas. */
	readonly canvas: HTMLCanvasElement;
	/** Carrega uma ação para pré-visualização. */
	loadAction(action: PreviewAction): Promise<void>;
	/** Define a direcção actual. */
	setDirection(direction: string): void;
	/** Inicia a reprodução. */
	play(): void;
	/** Pausa a reprodução. */
	pause(): void;
	/** Alterna play/pause. */
	toggle(): void;
	/** Define o frame actual (0 a frameCount-1). */
	setFrame(frame: number): void;
	/** Devolve o frame actual. */
	getFrame(): number;
	/** Devolve o número total de frames. */
	getFrameCount(): number;
	/** Define o fps e actualiza animationSpeed. */
	setFps(fps: number): void;
	/** Devolve o fps actual. */
	getFps(): number;
	/** true se estiver a reproduzir. */
	isPlaying(): boolean;
	/** Callback chamado a cada mudança de frame. */
	onFrameChange: ((frame: number) => void) | null;
	/** Callback chamado quando a reprodução termina (loop). */
	onLoop: (() => void) | null;
	/** Destrói o player e liberta recursos. */
	destroy(): void;
}

// ------------------------------------------------------------------ fábrica

export async function createPlayer(
	container: HTMLElement,
	config: PlayerConfig,
): Promise<PlayerControl> {
	// --- Configuração GLOBAL do PixiJS (ANTES do primeiro Assets.load) ---
	TextureSource.defaultOptions.scaleMode = "nearest";
	TextureSource.defaultOptions.autoGenerateMipmaps = false;

	// --- Canvas ---
	const canvas = config.canvas ?? document.createElement("canvas");
	canvas.width = config.width;
	canvas.height = config.height;
	if (!config.canvas) {
		container.appendChild(canvas);
	}

	// --- Aplicação PixiJS ---
	const app = new Application();
	await app.init({
		canvas,
		background: config.backgroundColor ?? 0x1a1a2e,
		antialias: false,
		resolution: window.devicePixelRatio || 1,
		autoDensity: true,
	});

	// --- Escala do palco INTEIRA ---
	const stageScale = config.scale ?? 2;
	const stage = new Container();
	stage.scale.set(stageScale);
	app.stage.addChild(stage);

	// Centra o palco
	stage.x = config.width / 2;
	stage.y = config.height / 2;

	// --- Estado ---
	let animatedSprite: AnimatedSprite | null = null;
	let currentDirection = "south";
	let currentFrame = 0;
	let currentFps = 8;
	let playing = false;
	let frameCount = 0;
	let currentAction: PreviewAction | null = null;
	let texturesByDirection: Record<string, Texture[]> = {};
	let anchorWarningShown = false;

	const onFrameChangeCb = { current: null as ((frame: number) => void) | null };
	const onLoopCb = { current: null as (() => void) | null };

	// --- Ticker ---
	app.ticker.add(() => {
		if (!animatedSprite || !playing) return;

		// Avança a animação
		const nextFrame = Math.floor(animatedSprite.currentFrame);
		if (nextFrame !== currentFrame) {
			currentFrame = nextFrame;
			onFrameChangeCb.current?.(currentFrame);

			// Loop detection
			if (currentFrame === 0 && animatedSprite.currentFrame < 1) {
				onLoopCb.current?.();
			}
		}
	});

	// ------------------------------------------------------------------
	// Carregar ação
	// ------------------------------------------------------------------

	async function loadAction(action: PreviewAction): Promise<void> {
		currentAction = action;
		frameCount = action.sidecar.frameCount;
		currentFps = action.sidecar.fps;

		// Verifica âncora
		if (action.sidecar.anchorSource === "padrao" && !anchorWarningShown) {
			console.warn(
				'⚠️ Âncora definida como "padrao" — a API escolheu o ponto de ancoragem. ' +
					"Considere definir uma âncora customizada no editor de esqueleto para " +
					"alinhamento preciso com o chão isométrico.",
			);
			anchorWarningShown = true;
		}

		// Carrega texturas
		texturesByDirection = {};
		for (const [dir, urls] of Object.entries(action.framesByDirection)) {
			const textures: Texture[] = [];
			for (const url of urls) {
				const texture = await Assets.load({
					src: url,
					loadParser: "loadTextures",
				});
				textures.push(texture as Texture);
			}
			texturesByDirection[dir] = textures;
		}

		// Cria o AnimatedSprite para a direcção actual
		updateSprite();

		// Configura animationSpeed
		if (animatedSprite) {
			animatedSprite.animationSpeed = currentFps / 60;
		}

		// Posiciona com âncora do sidecar
		applyAnchor();
	}

	// ------------------------------------------------------------------
	// Actualizar sprite
	// ------------------------------------------------------------------

	function updateSprite(): void {
		// Remove sprite anterior
		if (animatedSprite) {
			stage.removeChild(animatedSprite);
			animatedSprite.destroy();
			animatedSprite = null;
		}

		const textures = texturesByDirection[currentDirection];
		if (!textures || textures.length === 0) return;

		animatedSprite = new AnimatedSprite(textures);
		animatedSprite.anchor.set(0.5, 0.5);
		animatedSprite.animationSpeed = currentFps / 60;
		animatedSprite.loop = true;

		if (playing) {
			animatedSprite.play();
		} else {
			animatedSprite.gotoAndStop(currentFrame);
		}

		stage.addChild(animatedSprite);
	}

	// ------------------------------------------------------------------
	// Aplicar âncora
	// ------------------------------------------------------------------

	function applyAnchor(): void {
		if (!animatedSprite || !currentAction) return;

		const anchor = currentAction.sidecar.anchor;
		if (anchor) {
			animatedSprite.anchor.set(anchor.x, anchor.y);
		} else {
			animatedSprite.anchor.set(0.5, 1.0); // default: base do sprite
		}
	}

	// ------------------------------------------------------------------
	// API pública
	// ------------------------------------------------------------------

	function setDirection(dir: string): void {
		if (dir === currentDirection) return;
		currentDirection = dir;
		currentFrame = 0;
		updateSprite();
		onFrameChangeCb.current?.(0);
	}

	function play(): void {
		if (!animatedSprite) return;
		playing = true;
		animatedSprite.play();
	}

	function pause(): void {
		if (!animatedSprite) return;
		playing = false;
		animatedSprite.stop();
	}

	function toggle(): void {
		if (playing) pause();
		else play();
	}

	function setFrame(frame: number): void {
		currentFrame = Math.max(0, Math.min(frameCount - 1, Math.floor(frame)));
		if (animatedSprite) {
			animatedSprite.gotoAndStop(currentFrame);
		}
		onFrameChangeCb.current?.(currentFrame);
	}

	function getFrame(): number {
		return currentFrame;
	}

	function getFrameCount(): number {
		return frameCount;
	}

	function setFps(fps: number): void {
		currentFps = Math.max(1, Math.min(60, fps));
		if (animatedSprite) {
			animatedSprite.animationSpeed = currentFps / 60;
		}
	}

	function getFps(): number {
		return currentFps;
	}

	function isPlaying(): boolean {
		return playing;
	}

	function destroy(): void {
		if (animatedSprite) {
			animatedSprite.destroy();
			animatedSprite = null;
		}
		app.destroy(true, {
			children: true,
			texture: true,
			textureSource: true,
		});
		if (!config.canvas) {
			canvas.remove();
		}
	}

	const ctrl: PlayerControl = {
		canvas,
		loadAction,
		setDirection,
		play,
		pause,
		toggle,
		setFrame,
		getFrame,
		getFrameCount,
		setFps,
		getFps,
		isPlaying,
		onFrameChange: null,
		onLoop: null,
		destroy,
	};

	// Getters/setters delegam para wrappers mutáveis
	Object.defineProperty(ctrl, "onFrameChange", {
		get: () => onFrameChangeCb.current,
		set: (fn: ((frame: number) => void) | null) => {
			onFrameChangeCb.current = fn;
		},
		enumerable: true,
		configurable: true,
	});
	Object.defineProperty(ctrl, "onLoop", {
		get: () => onLoopCb.current,
		set: (fn: (() => void) | null) => {
			onLoopCb.current = fn;
		},
		enumerable: true,
		configurable: true,
	});

	return ctrl;
}
