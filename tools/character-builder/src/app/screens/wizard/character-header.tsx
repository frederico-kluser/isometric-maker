/**
 * Cabeçalho do wizard: seletor do personagem em edição + criação de derivado.
 *
 * "Novo personagem" só abre com o manequim pronto — derivar de um corpo-base
 * aberto congelaria trabalho incompleto; o bloqueio é explicado em tooltip.
 * O formulário é disclosure simples (o registry @motion não tem disclosure de
 * formulário — accordion é para listas, sheet é drawer de página).
 */
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from '@/components/ui/tooltip';
import { HoldToConfirmButton } from '@/components/motion-ui/hold-to-confirm';
import type { Character, Silhouette } from '../../../../server/model.ts';
import { wizard } from '../../../strings/wizard.ts';
import {
	api,
	useSelectedCharacter,
	type StudioResponse,
} from '../../studio-store.tsx';
import { ActionButton } from './action-button.tsx';
import { useAction } from './use-action.ts';
import { isMannequinReady } from './wizard-progress.ts';

const SILHOUETTES: readonly Silhouette[] = [
	'humano-medio',
	'humano-corpulento',
	'humano-esguio',
	'quadrupede',
];

export function CharacterHeader({
	studio,
	refresh,
}: {
	readonly studio: StudioResponse;
	readonly refresh: () => Promise<void>;
}) {
	const { characterId, setCharacterId } = useSelectedCharacter();
	const mannequinReady = isMannequinReady(studio);
	const [open, setOpen] = useState(false);
	const [deleting, setDeleting] = useState(false);

	const chars = studio.characters;
	const isEmpty = chars.length === 0;
	const selectedChar = chars.find((c) => c.id === characterId);
	// Bloqueia deletar se houver job rodando para o personagem selecionado.
	const hasRunningJob = selectedChar
		? Object.entries(studio.jobs).some(
				([key, job]) =>
					key.startsWith(selectedChar.id + '::') && job.status === 'gerando',
			)
		: false;

	const handleDelete = async (): Promise<void> => {
		if (!selectedChar) return;
		setDeleting(true);
		try {
			await api('characters', {
				method: 'DELETE',
				body: JSON.stringify({ characterId: selectedChar.id }),
			});
			// Seleciona o primeiro restante ou limpa.
			const fresh = await api<StudioResponse>('studio');
			const remaining = fresh.characters.filter((c) => c.id !== selectedChar.id);
			if (remaining.length > 0) {
				setCharacterId(remaining[0]!.id);
			}
		} catch {
			// Erro aparece no estado do action — o refresh já atualiza.
		} finally {
			setDeleting(false);
			await refresh();
		}
	};

	return (
		<div className="flex flex-col gap-4">
			{isEmpty ? (
				<div className="rounded-lg border border-dashed border-border p-6 text-center">
					<p className="text-sm font-medium text-muted-foreground">
						{wizard.header.semPersonagens}
					</p>
					<p className="mt-1 text-xs text-muted-foreground">
						{wizard.header.semPersonagensNota}
					</p>
				</div>
			) : null}
			<div className="flex flex-wrap items-end gap-3">
				<div className="flex flex-col gap-2">
					<span className="text-sm font-medium">
						{wizard.header.personagem}
					</span>
					<Select
						value={isEmpty ? '' : characterId}
						onValueChange={(v) => {
							if (typeof v === 'string' && v !== '') setCharacterId(v);
						}}
						disabled={isEmpty}
					>
						<SelectTrigger
							className="w-56"
							aria-label={wizard.header.seletorAria}
						>
							<SelectValue placeholder={isEmpty ? wizard.header.semPersonagens : undefined} />
						</SelectTrigger>
						<SelectContent>
							{chars.map((c) => (
								<SelectItem key={c.id} value={c.id}>
									{c.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
				{isEmpty || mannequinReady ? (
					<Button variant="outline" onClick={() => setOpen((o) => !o)}>
						<Plus aria-hidden />
						{wizard.header.novo}
					</Button>
				) : (
					<Tooltip>
						<TooltipTrigger render={<span className="inline-flex" />}>
							<Button variant="outline" disabled>
								<Plus aria-hidden />
								{wizard.header.novo}
							</Button>
						</TooltipTrigger>
						<TooltipContent>{wizard.header.novoBloqueado}</TooltipContent>
					</Tooltip>
				)}
				{selectedChar && !isEmpty ? (
					hasRunningJob ? (
						<Tooltip>
							<TooltipTrigger render={<span className="inline-flex" />}>
								<Button variant="ghost" size="icon" disabled>
									<Trash2 aria-hidden className="size-4" />
								</Button>
							</TooltipTrigger>
							<TooltipContent>
								{wizard.header.deletarBloqueado}
							</TooltipContent>
						</Tooltip>
					) : (
						<HoldToConfirmButton
							holdSeconds={2}
							mode="callback"
							onConfirm={() => void handleDelete()}
							className="h-9 px-3"
						>
							<Trash2 aria-hidden className="size-4" />
							<span className="ml-1.5">{wizard.header.deletar}</span>
						</HoldToConfirmButton>
					)
				) : null}
			</div>
			{open ? (
				<NewCharacterForm
					refresh={refresh}
					onCreated={(id) => {
						setCharacterId(id);
						setOpen(false);
					}}
					onCancel={() => setOpen(false)}
				/>
			) : null}
		</div>
	);
}

function NewCharacterForm({
	refresh,
	onCreated,
	onCancel,
}: {
	readonly refresh: () => Promise<void>;
	readonly onCreated: (id: string) => void;
	readonly onCancel: () => void;
}) {
	const [label, setLabel] = useState('');
	const [description, setDescription] = useState('');
	const [silhouette, setSilhouette] = useState<Silhouette>('humano-medio');
	const action = useAction(refresh);

	const canSubmit = label.trim() !== '' && description.trim() !== '';

	return (
		<Card size="sm">
			<CardHeader>
				<CardTitle>{wizard.header.novoTitulo}</CardTitle>
				<CardDescription>{wizard.header.novoNota}</CardDescription>
			</CardHeader>
			<CardContent className="flex flex-col gap-4">
				<div className="flex flex-col gap-2">
					<Label htmlFor="novo-personagem-nome">{wizard.header.campoNome}</Label>
					<Input
						id="novo-personagem-nome"
						value={label}
						onChange={(e) => setLabel(e.target.value)}
						placeholder={wizard.header.placeholderNome}
					/>
				</div>
				<div className="flex flex-col gap-2">
					<Label htmlFor="novo-personagem-descricao">
						{wizard.header.campoDescricao}
					</Label>
					<Textarea
						id="novo-personagem-descricao"
						value={description}
						onChange={(e) => setDescription(e.target.value)}
						placeholder={wizard.header.placeholderDescricao}
					/>
				</div>
				<div className="flex flex-col gap-2">
					<span className="text-sm font-medium">
						{wizard.header.campoSilhueta}
					</span>
					<Select
						value={silhouette}
						onValueChange={(v) => {
							if (typeof v === 'string') setSilhouette(v as Silhouette);
						}}
					>
						<SelectTrigger className="w-56">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{SILHOUETTES.map((s) => (
								<SelectItem key={s} value={s}>
									{wizard.silhuetas[s]}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
				<div className="flex items-center gap-3">
					<ActionButton
						state={action.state}
						message={action.message}
						label={wizard.header.criar}
						loadingLabel={wizard.acoes.aguarde}
						disabled={!canSubmit}
						onClick={() =>
							void action.run(async () => {
								const created = await api<Character>('characters', {
									method: 'POST',
									body: JSON.stringify({
										label: label.trim(),
										description: description.trim(),
										silhouette,
									}),
								});
								onCreated(created.id);
							})
						}
					/>
					<Button variant="ghost" onClick={onCancel}>
						{wizard.header.cancelar}
					</Button>
				</div>
			</CardContent>
		</Card>
	);
}
