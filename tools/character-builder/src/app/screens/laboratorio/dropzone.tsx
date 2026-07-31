/**
 * Dropzone de imagem do laboratório (arrastar PNG/JPG ou clicar).
 *
 * Código novo, justificado: o catálogo @motion não tem dropzone — as 35
 * peças são acordeão, sheet, toast, tabs e afins, nenhuma aceita arquivo.
 * Comportamento por elementos nativos (<button> + <input type="file">
 * escondido + eventos de drag), visual por classes semânticas shadcn.
 *
 * O preview é pixelado (regra do estúdio para sprites) e as dimensões são
 * lidas de naturalWidth/naturalHeight — a tela usa isso para preencher o
 * imageSize do /rotate.
 */
import { useRef, useState } from 'react';
import { laboratorio as SL } from '../../../strings/laboratorio.ts';

/** Imagem carregada: b64 puro para o body, data URI para o <img> de preview. */
export interface LoadedImage {
	readonly dataUri: string;
	readonly base64: string;
	readonly width: number;
	readonly height: number;
	readonly name: string;
}

/** ArrayBuffer → b64 em blocos (String.fromCharCode estoura a pilha com spread em arquivo grande). */
function toBase64(buf: ArrayBuffer): string {
	const bytes = new Uint8Array(buf);
	let binary = '';
	const CHUNK = 0x8000;
	for (let i = 0; i < bytes.length; i += CHUNK) {
		binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
	}
	return btoa(binary);
}

/** Lê o arquivo e mede a imagem decodificada (dimensões reais, não as do campo). */
async function readImageFile(file: File): Promise<LoadedImage> {
	const buf = await file.arrayBuffer();
	const base64 = toBase64(buf);
	const mime = file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png';
	const dataUri = `data:${mime};base64,${base64}`;
	const { width, height } = await new Promise<{ width: number; height: number }>(
		(resolve, reject) => {
			const img = new Image();
			img.onload = () =>
				resolve({ width: img.naturalWidth, height: img.naturalHeight });
			img.onerror = () => reject(new Error(`decode falhou: ${file.name}`));
			img.src = dataUri;
		},
	);
	return { dataUri, base64, width, height, name: file.name };
}

interface ImageDropzoneProps {
	readonly image: LoadedImage | null;
	readonly onLoad: (image: LoadedImage) => void;
	/** Texto da dropzone vazia (vem de S). */
	readonly emptyText: string;
	/** Texto sob o preview quando há imagem (vem de S). */
	readonly loadedHint: string;
	/** Versão baixa, para o init_image dentro do accordion. */
	readonly compact?: boolean;
}

export function ImageDropzone({
	image,
	onLoad,
	emptyText,
	loadedHint,
	compact = false,
}: ImageDropzoneProps) {
	const [over, setOver] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const inputRef = useRef<HTMLInputElement>(null);

	const acceptFile = async (file: File | undefined): Promise<void> => {
		if (!file) return;
		if (file.type !== 'image/png' && file.type !== 'image/jpeg') {
			setError(SL.upload.formatoInvalido);
			return;
		}
		try {
			const loaded = await readImageFile(file);
			setError(null);
			onLoad(loaded);
		} catch {
			setError(SL.upload.leituraArquivo);
		}
	};

	return (
		<div className="flex flex-col gap-2">
			<button
				type="button"
				onClick={() => inputRef.current?.click()}
				onDragOver={(e) => {
					e.preventDefault();
					setOver(true);
				}}
				onDragLeave={() => setOver(false)}
				onDrop={(e) => {
					e.preventDefault();
					setOver(false);
					void acceptFile(e.dataTransfer.files[0]);
				}}
				className={`flex w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-3 text-center text-sm transition-colors ${
					compact ? 'min-h-20 py-2' : 'min-h-36 py-4'
				} ${
					over
						? 'border-primary bg-accent'
						: 'border-border bg-muted/40 hover:bg-accent/60'
				}`}
			>
				{image ? (
					<>
						<img
							src={image.dataUri}
							alt={image.name}
							className={`max-w-full object-contain [image-rendering:pixelated] ${
								compact ? 'max-h-16' : 'max-h-36'
							}`}
						/>
						<span className="text-xs text-muted-foreground">{loadedHint}</span>
					</>
				) : (
					<span className="text-muted-foreground">{emptyText}</span>
				)}
			</button>
			<input
				ref={inputRef}
				type="file"
				accept="image/png,image/jpeg"
				className="hidden"
				onChange={(e) => {
					void acceptFile(e.target.files?.[0]);
					// Reset para escolher o MESMO arquivo de novo disparar change.
					e.target.value = '';
				}}
			/>
			{error !== null && <p className="text-xs text-destructive">{error}</p>}
		</div>
	);
}
