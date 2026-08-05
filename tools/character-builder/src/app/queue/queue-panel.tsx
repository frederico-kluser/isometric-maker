/**
 * O painel da fila — a gaveta que mostra o FIFO e deixa cancelar.
 *
 * ## O que faltava
 *
 * A fila FIFO persistente entrou em serviço no servidor na onda anterior, e
 * NENHUM arquivo em `src/` lia `queuePosition`; nada chamava
 * `DELETE /api/jobs/:key`. "Gerenciar em FIFO" só existia por `curl`. Este
 * arquivo é a superfície: a ordem em que as gerações vão rodar, o que está
 * rodando agora, quanto do teto está ocupado, e o cancelamento — com a verdade
 * sobre dinheiro dita ANTES da confirmação.
 *
 * ## Onde a decisão mora (e por que não aqui)
 *
 * Ordenação, grau de cancelamento, leitura da resposta do DELETE e a aba de
 * cada job vivem em `./queue-model.ts`, módulo puro testado sob `node --test` —
 * não há jsdom neste repositório e instalar é proibido. Aqui ficam só DOM,
 * fiação e o que o usuário lê (que vem de `src/strings/fila.ts`, ADR 0016).
 *
 * ## O catálogo é envolvido, nunca editado
 *
 * `src/components/motion-ui/**` é vendorizado pelo shadcn CLI e marcado "não
 * edite" — editar é perder no próximo `shadcn add`. Então:
 *
 *   - `Sheet`/`SheetBackdrop`/`SheetPanel` dão a gaveta (e a semântica modal do
 *     `<dialog>` nativo: foco preso, Escape, fundo inerte);
 *   - `SkeletonResolveList`/`SkeletonResolveRow` dão a lista que resolve sem
 *     salto de layout enquanto o primeiro snapshot não chega;
 *   - `ProgressBar` dá a ocupação do teto de admissão;
 *   - `useHoldToConfirm` dá o gesto destrutivo — o MESMO de
 *     `laboratorio/delete-block-button.tsx`, e pelo mesmo motivo de lá o botão
 *     pronto (`HoldToConfirmButton`, largura fixa `w-60`) não serve numa linha
 *     de lista: o `className` dele é concatenado, não passa por
 *     `tailwind-merge`, e disputar precedência com `w-60` não é garantido;
 *   - `ToastStack` dá o poço de avisos, envolvido em `./queue-toasts.ts`.
 *
 * O gatilho (`SheetTrigger`) fica com a aparência do catálogo, sem `className`:
 * a mesma armadilha de precedência que afasta o `HoldToConfirmButton` afastaria
 * qualquer tentativa de retonar o botão por cima.
 *
 * ## Sondagens a mais, de propósito — e a conta inteira
 *
 * `useStudio()` mantém intervalo PRÓPRIO por chamada, e esta onda acrescentou
 * duas: esta (`QueuePanel`, montada no shell) e a da bancada de blocos
 * (`laboratorio/blocks-panel.tsx`, que precisa do registro do servidor para
 * sobreviver ao F5). Some com a que já existia na tela e a conta da aba
 * Laboratório vai de 1 para **3** `GET /api/studio` a cada 3 s — os dois painéis
 * de lá ficam sempre MONTADOS, o inativo só recebe `hidden`
 * (`screens/laboratorio.tsx`), então nenhuma delas dorme quando a seção troca.
 *
 * O outro caminho seria transformar `useStudio` em contexto e mudar a via de
 * dados de todas as telas — mudança grande numa onda que já toca nove arquivos.
 * Numa ferramenta local de usuário único, três GETs por 3 s contra o próprio
 * disco são baratos; a alternativa era o painel mostrar uma fila velha.
 */
import { useState } from 'react';
import { motion } from 'motion/react';
import {
	ArrowRightIcon,
	ClockIcon,
	LoaderCircleIcon,
	Trash2Icon,
	TriangleAlertIcon,
} from 'lucide-react';
import {
	Sheet,
	SheetBackdrop,
	SheetClose,
	SheetHandle,
	SheetPanel,
	SheetTrigger,
	useSheet,
} from '@/components/motion-ui/sheet';
import {
	Skeleton,
	SkeletonResolveList,
	SkeletonResolveRow,
} from '@/components/motion-ui/skeleton';
import { ProgressBar } from '@/components/motion-ui/progress-bar';
import { Toast, ToastStack, useToast } from '@/components/motion-ui/toast-stack';
import { useHoldToConfirm } from '@/components/motion-ui/hold-to-confirm';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { characterOf } from '../job-scope.ts';
import { api, useSelectedCharacter, useStudio } from '../studio-store.tsx';
import { useStudioNavigation } from '../studio-navigation.tsx';
import {
	buildQueueRows,
	concurrencySourceOf,
	describeCancelOutcome,
	occupancyShare,
	summariseQueue,
	tabForScope,
	type QueueRow,
	type QueueStatsInput,
	type QueueSummary,
} from './queue-model.ts';
import { useQueueNotices, type NoticeTone } from './queue-toasts.ts';
import { shell as SH } from '../../strings/shell.ts';
import {
	cancelamentoFalhou,
	cancelarAria,
	escopoBancada,
	escopoDesconhecido,
	escopoPeca,
	escopoPose,
	escopoWizard,
	fila as F,
	gatilhoComAtivos,
	ocupacaoTexto,
	ondeRefazer,
	origemDoTeto,
	posicaoNaFila,
	refazerAria,
	resultadoDoCancelamento,
	resumoDaFila,
} from '../../strings/fila.ts';

/** Id do título da gaveta — é o `aria-labelledby` do `<dialog>`. */
const TITLE_ID = 'fila-titulo';

/** Ossos mostrados enquanto o primeiro snapshot do estúdio não chegou. */
const BONES = [0, 1, 2];

export function QueuePanel() {
	// UMA chamada de `useStudio` no painel inteiro. Cada chamada monta o seu
	// próprio intervalo de 3 s: uma por linha da lista transformaria a fila em
	// uma tempestade de GETs proporcional ao tamanho dela.
	const { studio, refresh, error } = useStudio();
	const rows = buildQueueRows(studio?.jobs);
	const summary = summariseQueue(rows);
	const loading = studio === undefined && error === null;

	return (
		<Sheet>
			<SheetTrigger>
				<ClockIcon className="size-4" aria-hidden="true" />
				{summary.active > 0 ? gatilhoComAtivos(summary.active) : F.abrir}
			</SheetTrigger>
			<SheetBackdrop label={F.fecharAria} />
			<SheetPanel labelledBy={TITLE_ID} className="max-h-[85dvh] overflow-y-auto">
				<QueueDrawer
					rows={rows}
					summary={summary}
					loading={loading}
					error={error}
					stats={studio?.queue}
					characters={studio?.characters ?? EMPTY_CHARACTERS}
					refresh={refresh}
				/>
			</SheetPanel>
		</Sheet>
	);
}

/** Identidade estável: `[]` inline mudaria de referência a cada poll. */
const EMPTY_CHARACTERS: readonly CharacterLabel[] = [];

/** O mínimo que a linha precisa para mostrar o nome do personagem dono. */
interface CharacterLabel {
	readonly id: string;
	readonly label: string;
}

// ------------------------------------------------------------------ gaveta

function QueueDrawer({
	rows,
	summary,
	loading,
	error,
	stats,
	characters,
	refresh,
}: {
	readonly rows: readonly QueueRow[];
	readonly summary: QueueSummary;
	readonly loading: boolean;
	readonly error: string | null;
	readonly stats: QueueStatsInput | undefined;
	readonly characters: readonly CharacterLabel[];
	readonly refresh: () => Promise<void>;
}) {
	const notices = useQueueNotices();
	const share = occupancyShare(stats);
	const source = concurrencySourceOf(stats);
	const ceiling = stats?.concurrency;
	const inFlight = stats?.inFlightWeight;

	const running = rows.filter((r) => r.phase === 'running');
	const queued = rows.filter((r) => r.phase === 'queued');
	const finished = rows.filter((r) => r.phase === 'finished');

	return (
		<div className="flex flex-col gap-4 pt-1">
			<header className="flex items-start justify-between gap-3">
				<div className="flex flex-col gap-1">
					<h2 id={TITLE_ID} className="text-lg font-semibold">
						{F.titulo}
					</h2>
					<p className="text-xs text-muted-foreground">{F.descricao}</p>
				</div>
				<SheetClose label={F.fechar} />
			</header>

			{/* ─────────── ocupação do teto de admissão ─────────── */}
			{typeof ceiling === 'number' && typeof inFlight === 'number' ? (
				<div className="flex flex-col gap-1.5">
					<ProgressBar
						value={share}
						progressbar
						aria-label={F.teto.aria}
						label={<span className="text-xs font-medium">{F.teto.rotulo}</span>}
						valueLabel={
							<span className="text-xs text-muted-foreground">
								{ocupacaoTexto(inFlight, ceiling)}
								{source !== null ? ` · ${origemDoTeto(source)}` : ''}
							</span>
						}
					/>
					<p className="text-[11px] leading-snug text-muted-foreground">
						{F.teto.nota} {F.teto.estimativa}
					</p>
				</div>
			) : null}

			<p className="text-xs text-muted-foreground" role="status">
				{loading
					? F.carregando
					: resumoDaFila(summary.running, summary.queued)}
			</p>

			{error !== null ? (
				<p
					role="alert"
					className="rounded-lg border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive"
				>
					{F.semServidor}
				</p>
			) : null}

			{/* ─────────── a lista ─────────── */}
			<SkeletonResolveList loading={loading}>
				{loading ? (
					<ul className="flex flex-col gap-2">
						{BONES.map((i) => (
							<li key={i}>
								<SkeletonResolveRow
									index={i}
									content={<div className="h-16" />}
									skeleton={<Skeleton className="h-16 w-full" />}
								/>
							</li>
						))}
					</ul>
				) : rows.length === 0 ? (
					<p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
						{F.vazia}
					</p>
				) : (
					<div className="flex flex-col gap-4">
						<QueueSection
							title={F.secoes.rodando}
							rows={running}
							offset={0}
							characters={characters}
							notify={notices.push}
							refresh={refresh}
						/>
						<QueueSection
							title={F.secoes.naFila}
							rows={queued}
							offset={running.length}
							characters={characters}
							notify={notices.push}
							refresh={refresh}
						/>
						<QueueSection
							title={F.secoes.encerrados}
							rows={finished}
							offset={running.length + queued.length}
							characters={characters}
							notify={notices.push}
							refresh={refresh}
						/>
					</div>
				)}
			</SkeletonResolveList>

			<footer className="flex flex-col gap-1 pb-1 text-[11px] leading-snug text-muted-foreground">
				<p>{F.notaPersistencia}</p>
				<p>{F.notaEscopo}</p>
			</footer>

			{/* O poço de avisos mora DENTRO da gaveta — ver ./queue-toasts.ts. Sem
			    `className`: o poço já vem posicionado e sobrescrever `bottom-6`
			    por concatenação disputaria precedência de CSS, que não é
			    garantida (a mesma armadilha do `HoldToConfirmButton`). */}
			<ToastStack>
				{notices.notices.map((n) => (
					<Toast key={n.id}>
						<NoticeCard
							text={n.text}
							tone={n.tone}
							onDismiss={() => notices.dismiss(n.id)}
						/>
					</Toast>
				))}
			</ToastStack>
		</div>
	);
}

function QueueSection({
	title,
	rows,
	offset,
	characters,
	notify,
	refresh,
}: {
	readonly title: string;
	readonly rows: readonly QueueRow[];
	/** Índice global da primeira linha — o escalonamento é da lista inteira. */
	readonly offset: number;
	readonly characters: readonly CharacterLabel[];
	readonly notify: (text: string, tone: NoticeTone) => void;
	readonly refresh: () => Promise<void>;
}) {
	if (rows.length === 0) return null;
	return (
		<section className="flex flex-col gap-2">
			<h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
				{title}
			</h3>
			<ul className="flex flex-col gap-2">
				{rows.map((row, i) => (
					<li key={row.key}>
						<SkeletonResolveRow
							index={offset + i}
							content={
								<QueueRowCard
									row={row}
									characters={characters}
									notify={notify}
									refresh={refresh}
								/>
							}
							skeleton={<Skeleton className="h-16 w-full" />}
						/>
					</li>
				))}
			</ul>
		</section>
	);
}

// ------------------------------------------------------------------ linha

function QueueRowCard({
	row,
	characters,
	notify,
	refresh,
}: {
	readonly row: QueueRow;
	readonly characters: readonly CharacterLabel[];
	readonly notify: (text: string, tone: NoticeTone) => void;
	readonly refresh: () => Promise<void>;
}) {
	const owner = characterOf(row.scope);
	const ownerLabel =
		owner === undefined
			? undefined
			: (characters.find((c) => c.id === owner)?.label ?? owner);

	return (
		<div className="flex flex-col gap-2 rounded-lg border border-border bg-muted/30 p-3">
			<div className="flex items-start justify-between gap-2">
				<div className="flex min-w-0 flex-col gap-0.5">
					<span className="truncate text-sm font-medium">{row.label}</span>
					<span className="truncate text-[11px] text-muted-foreground">
						{describeScope(row, ownerLabel)}
					</span>
				</div>
				<div className="flex shrink-0 flex-col items-end gap-1">
					<Badge variant={badgeVariant(row)}>{F.status[row.status]}</Badge>
					{row.position !== null ? (
						<span className="text-[11px] text-muted-foreground">
							{posicaoNaFila(row.position)}
						</span>
					) : null}
				</div>
			</div>

			{row.message !== null ? (
				<p className="text-[11px] leading-snug text-muted-foreground">
					{row.message}
				</p>
			) : null}

			{row.needsDecision ? <InterruptedNotice /> : null}

			{row.holdsMoney && !row.needsDecision ? (
				<p className="text-[11px] leading-snug text-muted-foreground">
					{F.pagoSemArtefatoNota}
				</p>
			) : null}

			<div className="flex flex-wrap items-center gap-2">
				{row.cancel !== 'none' ? (
					<CancelControl row={row} notify={notify} refresh={refresh} />
				) : null}
				{row.canRetry ? <RetryControl row={row} owner={owner} /> : null}
			</div>
		</div>
	);
}

function badgeVariant(row: QueueRow): 'default' | 'secondary' | 'outline' | 'destructive' {
	if (row.status === 'falhou' || row.status === 'interrompido') return 'destructive';
	if (row.status === 'gerando') return 'default';
	if (row.status === 'pronto') return 'secondary';
	return 'outline';
}

/** De quem é o job — lido da chave, nunca adivinhado. */
function describeScope(row: QueueRow, ownerLabel: string | undefined): string {
	const scope = row.scope;
	switch (scope.kind) {
		case 'wizard':
			return escopoWizard(ownerLabel ?? scope.characterId, scope.step);
		case 'pose':
			return escopoPose(ownerLabel ?? scope.characterId, scope.poseId);
		case 'wardrobe':
			return escopoPeca(ownerLabel ?? scope.characterId, scope.itemId);
		case 'bench':
			return escopoBancada(scope.bench);
		case 'unknown':
			return escopoDesconhecido(scope.key);
	}
}

function InterruptedNotice() {
	return (
		<div className="flex flex-col gap-1 rounded-md border border-destructive/40 bg-destructive/5 px-2.5 py-2">
			<span className="flex items-center gap-1.5 text-xs font-medium text-destructive">
				<TriangleAlertIcon className="size-3.5" aria-hidden="true" />
				{F.interrompido.titulo}
			</span>
			<p className="text-[11px] leading-snug text-muted-foreground">
				{F.interrompido.explicacao}
			</p>
			<p className="text-[11px] leading-snug text-muted-foreground">
				{F.interrompido.comoRefazer}
			</p>
		</div>
	);
}

// ------------------------------------------------------------------ cancelar

/**
 * O aviso de dinheiro vem ANTES do gesto, sempre — é a razão de este controle
 * existir em vez de um botão de lixeira solto. `'na-fila'` não gastou nada e
 * cancela com um clique; `'gerando'` exige pressionar-e-segurar, porque a
 * cobrança já pode ter acontecido e nada disso volta.
 */
/** O corpo do `DELETE /api/jobs/:key` — lido por `describeCancelOutcome`. */
interface CancelResponse {
	readonly ok?: boolean;
	readonly status?: string;
	readonly aborted?: boolean;
	readonly paid?: boolean;
}

function CancelControl({
	row,
	notify,
	refresh,
}: {
	readonly row: QueueRow;
	readonly notify: (text: string, tone: NoticeTone) => void;
	readonly refresh: () => Promise<void>;
}) {
	const [busy, setBusy] = useState(false);

	const run = async (): Promise<void> => {
		setBusy(true);
		try {
			// A chave vai CRUA no caminho, sem `encodeURIComponent`: a rota faz
			// `url.pathname.slice("/api/jobs/".length)` e não decodifica nada
			// (`server/api.ts`), então uma chave codificada nunca casaria com o
			// registro e todo cancelamento viraria 404. As chaves só contêm slug,
			// hex e `::`, que atravessam o caminho sem escape.
			const body = await api<CancelResponse>(`jobs/${row.key}`, {
				method: 'DELETE',
			});
			// `row.paid` entra junto: o servidor responde `paid: false` LITERAL
			// quando só tira da fila, e um pedido refeito herdou a cobrança do
			// anterior. Sem isso a tela diria "nada foi cobrado" sobre dinheiro
			// que já saiu — ver o cabeçalho de ./queue-model.ts.
			const outcome = describeCancelOutcome(body, row.paid);
			notify(
				outcome.kind === 'aborted'
					? resultadoDoCancelamento('aborted', { pago: outcome.paid })
					: outcome.kind === 'removed'
						? resultadoDoCancelamento('removed', { pago: outcome.paid })
						: outcome.kind === 'already-finished'
							? resultadoDoCancelamento('already-finished', {
									...(outcome.status !== null
										? { status: F.status[outcome.status] }
										: {}),
								})
							: resultadoDoCancelamento(outcome.kind),
				outcome.kind === 'aborted' ||
					outcome.kind === 'unknown' ||
					(outcome.kind === 'removed' && outcome.paid)
					? 'money'
					: 'neutral',
			);
			await refresh();
		} catch (err) {
			notify(
				cancelamentoFalhou(err instanceof Error ? err.message : String(err)),
				'error',
			);
		} finally {
			setBusy(false);
		}
	};

	// Três graus, quatro frases: `maybe-paid` tem duas causas diferentes e não
	// pode ter o mesmo texto. Num job 'na-fila' que herdou cobrança, dizer "já
	// entrou em execução" seria tão falso quanto dizer "não custa nada".
	const warning =
		row.cancel === 'free'
			? F.cancelar.livre
			: row.cancel === 'paid'
				? F.cancelar.pago
				: row.status === 'na-fila'
					? F.cancelar.naFilaHerdado
					: F.cancelar.talvezPago;

	return (
		<div className="flex w-full flex-col gap-1.5">
			<p
				className={
					row.cancel === 'free'
						? 'text-[11px] leading-snug text-muted-foreground'
						: 'text-[11px] leading-snug font-medium text-destructive'
				}
			>
				{warning}
			</p>
			{/* Só faz sentido sobre trabalho EM VOO: um job que ainda espera a
			    vez não tem nada rodando para terminar sozinho, e a vaga dele
			    nem chegou a ser ocupada. */}
			{row.status === 'gerando' && !row.abortsForReal ? (
				<p className="text-[11px] leading-snug text-muted-foreground">
					{F.cancelar.vagaDemora}
				</p>
			) : null}
			{row.cancel === 'free' ? (
				<Button
					variant="outline"
					size="sm"
					disabled={busy}
					aria-label={cancelarAria(row.label)}
					onClick={() => void run()}
					className="w-fit"
				>
					{busy ? (
						<LoaderCircleIcon className="size-3.5 animate-spin" aria-hidden="true" />
					) : (
						<Trash2Icon className="size-3.5" aria-hidden="true" />
					)}
					{busy ? F.cancelar.emCurso : F.cancelar.acaoLivre}
				</Button>
			) : (
				<HoldToCancel label={row.label} busy={busy} onConfirm={() => void run()} />
			)}
		</div>
	);
}

/**
 * Pressionar-e-segurar com superfície própria, pelo mesmo motivo registrado em
 * `laboratorio/delete-block-button.tsx`: a MECÂNICA (rampa determinística,
 * soltar cancela, Espaço segura) vem do hook do catálogo; só a geometria é
 * daqui, porque o botão pronto tem largura fixa de formulário.
 */
function HoldToCancel({
	label,
	busy,
	onConfirm,
}: {
	readonly label: string;
	readonly busy: boolean;
	readonly onConfirm: () => void;
}) {
	const { progress, holdHandlers, reset } = useHoldToConfirm({
		holdSeconds: 2,
		onConfirm: () => {
			onConfirm();
			// Solta a trava: a linha pode continuar montada (o cancelamento
			// falhou, ou o job já tinha acabado) e um segundo gesto precisa valer.
			reset();
		},
	});

	return (
		<button
			type="button"
			aria-label={cancelarAria(label)}
			aria-busy={busy || undefined}
			disabled={busy}
			className="relative inline-flex h-8 w-fit touch-none items-center justify-center gap-1.5 overflow-hidden rounded-md border border-destructive/50 px-3 text-xs font-medium text-destructive transition-colors outline-none select-none hover:bg-destructive/10 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
			{...holdHandlers}
		>
			{busy ? (
				<LoaderCircleIcon className="size-3.5 animate-spin" aria-hidden="true" />
			) : (
				<Trash2Icon className="size-3.5" aria-hidden="true" />
			)}
			{busy ? F.cancelar.emCurso : F.cancelar.acaoSegure}
			<motion.span
				aria-hidden="true"
				style={{ scaleX: progress }}
				className="absolute inset-x-0 bottom-0 h-0.5 origin-left bg-destructive"
			/>
		</button>
	);
}

// ------------------------------------------------------------------ refazer

/**
 * O caminho de volta. O painel NÃO refaz o job — não existe rota de retomada, e
 * um painel que explica custo não é lugar de disparar geração paga. Ele leva
 * até a tela dona (e seleciona o personagem dono, quando há um), onde o botão
 * de gerar já existe e já sabe o que enviar.
 */
function RetryControl({
	row,
	owner,
}: {
	readonly row: QueueRow;
	readonly owner: string | undefined;
}) {
	const { goTo } = useStudioNavigation();
	const { setCharacterId } = useSelectedCharacter();
	const { setOpen } = useSheet();
	const tab = tabForScope(row.scope);

	if (tab === null) {
		return (
			<p className="text-[11px] leading-snug text-muted-foreground">
				{F.refazer.semDestino}
			</p>
		);
	}

	return (
		<div className="flex w-full flex-col gap-1">
			<Button
				variant="secondary"
				size="sm"
				className="w-fit"
				aria-label={refazerAria(row.label)}
				onClick={() => {
					if (owner !== undefined) setCharacterId(owner);
					goTo(tab);
					setOpen(false);
				}}
			>
				<ArrowRightIcon className="size-3.5" aria-hidden="true" />
				{F.refazer.acao}
			</Button>
			<p className="text-[11px] leading-snug text-muted-foreground">
				{ondeRefazer(SH.tabs[tab])}
				{tab === 'laboratorio' ? ` ${F.refazer.notaSecao}` : ''}
			</p>
		</div>
	);
}

// ------------------------------------------------------------------ avisos

function NoticeCard({
	text,
	tone,
	onDismiss,
}: {
	readonly text: string;
	readonly tone: NoticeTone;
	readonly onDismiss: () => void;
}) {
	const { isVisible } = useToast();
	const border =
		tone === 'money'
			? 'border-destructive/60'
			: tone === 'error'
				? 'border-destructive/40'
				: 'border-border';
	return (
		<div
			role="status"
			className={`pointer-events-auto flex items-start gap-2 rounded-lg border ${border} bg-background/95 px-3 py-2 shadow-lg`}
		>
			<p className="flex-1 text-[11px] leading-snug">{text}</p>
			<button
				type="button"
				tabIndex={isVisible ? undefined : -1}
				onClick={onDismiss}
				className="shrink-0 text-[11px] font-medium text-muted-foreground underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
			>
				{F.fechar}
			</button>
		</div>
	);
}
