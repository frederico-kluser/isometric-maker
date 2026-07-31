/**
 * Cartão de resultado do laboratório: original × rotacionada lado a lado,
 * uso retornado pela chamada (dado cru do servidor, sem fala de orçamento),
 * path gravado e a nota de idempotência do cache.
 *
 * Estado de espera honesto: a chamada é síncrona e demora — enquanto corre,
 * skeletons (peça do registry @motion) seguram o lugar das duas imagens e
 * uma linha de texto diz o que está acontecendo.
 */
import { Badge } from '@/components/ui/badge';
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from '@/components/ui/card';
import { Skeleton } from '@/components/motion-ui/skeleton';
import type { RotateLabResult } from '../../../../server/rotate-lab.ts';
import {
	laboratorio as SL,
	usoGeracoes,
	usoUsd,
} from '../../../strings/laboratorio.ts';

/** O que a tela guarda de uma execução concluída para o lado a lado. */
export interface ResultPair {
	/** data URI da imagem que foi enviada (snapshot — o form pode mudar depois). */
	readonly originalDataUri: string;
	/** Resumo dos parâmetros usados (mesmo formato das linhas do histórico). */
	readonly summary: string;
	readonly result: RotateLabResult;
}

interface ResultPanelProps {
	readonly pair: ResultPair | null;
	readonly running: boolean;
}

function Figure({ label, src }: { readonly label: string; readonly src: string }) {
	return (
		<figure className="flex flex-col gap-1.5">
			<figcaption className="text-xs font-medium text-muted-foreground">
				{label}
			</figcaption>
			<div className="flex min-h-40 items-center justify-center rounded-lg border border-border bg-muted/30 p-2">
				<img
					src={src}
					alt={label}
					className="max-h-56 max-w-full object-contain [image-rendering:pixelated]"
				/>
			</div>
		</figure>
	);
}

export function ResultPanel({ pair, running }: ResultPanelProps) {
	const usage = pair?.result.usage;

	return (
		<Card>
			<CardHeader>
				<CardTitle>{SL.resultado.titulo}</CardTitle>
				<CardDescription>{SL.resultado.notaCache}</CardDescription>
			</CardHeader>
			<CardContent className="flex flex-col gap-4">
				{running ? (
					<>
						<div className="grid grid-cols-2 gap-3">
							<Skeleton className="h-44 w-full" />
							<Skeleton className="h-44 w-full" />
						</div>
						<p className="text-sm text-muted-foreground" role="status">
							{SL.executar.aguardando}
						</p>
					</>
				) : pair === null ? (
					<p className="text-sm text-muted-foreground">{SL.resultado.vazio}</p>
				) : (
					<>
						<div className="grid grid-cols-2 gap-3">
							<Figure label={SL.resultado.original} src={pair.originalDataUri} />
							<Figure
								label={SL.resultado.rotacionada}
								src={`data:image/png;base64,${pair.result.image}`}
							/>
						</div>
						<p className="text-sm text-muted-foreground">{pair.summary}</p>
						{usage ? (
							<div className="flex flex-wrap items-center gap-2 text-sm">
								<span className="text-muted-foreground">{SL.resultado.uso}:</span>
								{typeof usage.usd === 'number' && (
									<Badge variant="secondary">{usoUsd(usage.usd)}</Badge>
								)}
								{typeof usage.generations === 'number' && (
									<Badge variant="secondary">
										{usoGeracoes(usage.generations)}
									</Badge>
								)}
							</div>
						) : (
							<Badge variant="outline">{SL.resultado.doCache}</Badge>
						)}
						<p className="text-xs break-all text-muted-foreground">
							{SL.resultado.caminho}: <code>{pair.result.path}</code>
						</p>
					</>
				)}
			</CardContent>
		</Card>
	);
}
