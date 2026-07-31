/**
 * Dropzone de referência da face sul (PNG/JPG) — padrão copiado do
 * laboratório (dropzone.tsx): <button> + <input type="file"> escondido +
 * eventos de drag, b64 em blocos, validação decodificando a imagem.
 * Componente próprio em vez de import cruzado entre telas: o wizard
 * precisa de estados que a peça do laboratório não tem.
 *
 * Dois estados de referência, um exclui o outro na exibição:
 *
 *  1. Escolha LOCAL (ainda não enviada): preview pelo data URI; o b64 puro
 *     sobe no POST /api/wizard/south como referenceBase64 — o servidor
 *     grava em assets/wizard/<charId>/reference.png e usa como init_image
 *     (força 500) na criação da sul. Remover aqui só descarta a escolha.
 *  2. Referência GRAVADA no servidor: preview de
 *     /assets/wizard/<charId>/reference.png. A existência é sondada por um
 *     Image() com cache-bust (a pasta é o publicDir do Vite — 404 vira
 *     onerror), porque o studio.json não carrega esse flag. Remover chama
 *     DELETE /api/wizard/south/reference e re-sonda.
 */
import { Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { wizard } from '../../../strings/wizard.ts';
import { api } from '../../studio-store.tsx';
import { ActionButton } from './action-button.tsx';
import { useAction } from './use-action.ts';

/** Referência escolhida: b64 puro para o body, data URI para o preview. */
export interface ReferenceImage {
	readonly dataUri: string;
	readonly base64: string;
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

/** Lê o arquivo e valida que decodifica como imagem (rejeita disfarçados). */
async function readImageFile(file: File): Promise<ReferenceImage> {
	const buf = await file.arrayBuffer();
	const base64 = toBase64(buf);
	const mime = file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png';
	const dataUri = `data:${mime};base64,${base64}`;
	await new Promise<void>((resolve, reject) => {
		const img = new Image();
		img.onload = () => resolve();
		img.onerror = () => reject(new Error(`decode falhou: ${file.name}`));
		img.src = dataUri;
	});
	return { dataUri, base64, name: file.name };
}

export interface ReferencePickerProps {
	readonly characterId: string;
	/** Escolha local (ainda não enviada); null quando não há. */
	readonly image: ReferenceImage | null;
	readonly onChange: (image: ReferenceImage | null) => void;
	/** Mude para forçar nova sondagem do servidor (ex.: após o POST da sul). */
	readonly probeKey: number;
	readonly refresh: () => Promise<void>;
	readonly disabled?: boolean;
}

export function ReferencePicker({
	characterId,
	image,
	onChange,
	probeKey,
	refresh,
	disabled = false,
}: ReferencePickerProps) {
	const refUrl = `/assets/wizard/${characterId}/reference.png`;
	const [serverHas, setServerHas] = useState(false);
	const [tick, setTick] = useState(0);
	const [over, setOver] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const inputRef = useRef<HTMLInputElement>(null);
	const remove = useAction(refresh);

	// Sondagem: o studio.json não diz se há referência gravada — o arquivo
	// público é a única fonte. tick/probeKey na query furam o cache do browser.
	useEffect(() => {
		let live = true;
		const probe = new Image();
		probe.onload = () => {
			if (live) setServerHas(true);
		};
		probe.onerror = () => {
			if (live) setServerHas(false);
		};
		probe.src = `${refUrl}?v=${tick}-${probeKey}`;
		return () => {
			live = false;
		};
	}, [refUrl, tick, probeKey]);

	const acceptFile = async (file: File | undefined): Promise<void> => {
		if (!file) return;
		if (file.type !== 'image/png' && file.type !== 'image/jpeg') {
			setError(wizard.sul.referenciaFormato);
			return;
		}
		try {
			const loaded = await readImageFile(file);
			setError(null);
			onChange(loaded);
		} catch {
			setError(wizard.sul.referenciaLeitura);
		}
	};

	const removeServer = (): void =>
		void remove.run(async () => {
			await api('wizard/south/reference', {
				method: 'DELETE',
				body: JSON.stringify({ characterId }),
			});
			setTick((v) => v + 1);
		});

	return (
		<div className="flex flex-col gap-2">
			{image ? (
				<div className="flex items-center gap-3 rounded-lg border border-border bg-muted/40 p-3">
					<img
						src={image.dataUri}
						alt={wizard.sul.referenciaAlt}
						className="max-h-20 max-w-20 rounded-md object-contain [image-rendering:pixelated]"
					/>
					<span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
						{image.name}
					</span>
					<Button
						type="button"
						variant="outline"
						size="sm"
						disabled={disabled}
						onClick={() => onChange(null)}
					>
						<Trash2 aria-hidden />
						{wizard.sul.referenciaRemover}
					</Button>
				</div>
			) : serverHas ? (
				<div className="flex flex-col gap-2 rounded-lg border border-border bg-muted/40 p-3">
					<div className="flex items-center gap-3">
						<img
							src={`${refUrl}?v=${tick}-${probeKey}`}
							alt={wizard.sul.referenciaAlt}
							className="max-h-20 max-w-20 rounded-md object-contain [image-rendering:pixelated]"
						/>
						<span className="flex-1 text-xs text-muted-foreground">
							{wizard.sul.referenciaGravada}
						</span>
					</div>
					<ActionButton
						state={remove.state}
						message={remove.message}
						label={wizard.sul.referenciaRemover}
						loadingLabel={wizard.acoes.aguarde}
						idleSurface="bg-secondary text-secondary-foreground"
						disabled={disabled}
						onClick={removeServer}
					/>
				</div>
			) : (
				<button
					type="button"
					disabled={disabled}
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
					className={`flex min-h-20 w-full flex-col items-center justify-center gap-1 rounded-lg border border-dashed px-3 py-2 text-center text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
						over
							? 'border-primary bg-accent'
							: 'border-border bg-muted/40 hover:bg-accent/60'
					}`}
				>
					<span className="text-muted-foreground">
						{wizard.sul.referenciaVazia}
					</span>
				</button>
			)}
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
			<p className="text-xs text-muted-foreground">{wizard.sul.referenciaNota}</p>
			{error !== null ? (
				<p role="alert" className="text-xs text-destructive">
					{error}
				</p>
			) : null}
		</div>
	);
}
